/**
 * padi's pty-host endpoint — the composition root for **the door** (B2).
 *
 * Before B2 this module constructed the pty-host IN-PROCESS at import time and
 * served it on a socket. Now padi is a *client* of a `kaval` daemon it
 * spawns: `ensureLocalEndpoint()` runs the always-recycle boot (kill any
 * survivor, spawn fresh, connect + handshake) through the supervisor spine
 * (`@kolu/surface-daemon-supervisor`), and `ptyHostClient` is **one face over a
 * forwarding dispatch** that resolves whatever connection the endpoint currently
 * holds — so `LocalTerminalEndpoint` keeps one import-time reference while the
 * live socket client is established asynchronously (no module-global host, no
 * import-time RPC). The spawn *policy* stays here, kolu's soul: `buildTerminalSpawnInput`
 * composes the env/identity/rcfile layers against the daemon's `system.info`,
 * exactly as before — only now over the wire.
 *
 * See `docs/atlas/src/content/atlas/pty-daemon.mdx` (B2 — the door).
 */

import {
  createEndpoint,
  type Endpoint,
  type EndpointStatus,
  type RestartSteps,
  serializeRestart,
} from "@kolu/surface-daemon-supervisor";
import type { DaemonHomePaths } from "@kolu/surface-daemon";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Cause, Context, Effect, Fiber, MutableRef, Ref } from "effect";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import {
  DEFAULT_MIRROR_SCROLLBACK,
  kavalConvergencePolicy,
  type PtyHostClient,
  type PtyHostIdentity,
  ptyHostClientOver,
  type PtyHostSpawnInput,
  type PtyHostSystemInfo,
} from "kaval";
import {
  CONTAINING_TERMINAL_ENV,
  cleanEnv,
  koluIdentityEnv,
  prepareShellInit,
  prependPathEntries,
  readAgentToolsBake,
  TERMINAL_TOOLS_PATH_ENV,
} from "kolu-pty";
import type { KavalObservation } from "../kavalObservation.ts";
import { log } from "../log.ts";
import { encodeHostLocation, LOCAL_LOCATION } from "../vocab.ts";
import {
  connectKaval,
  type KavalConnectionMetadata,
  probeKavalForConvergence,
} from "./connect.ts";
import {
  getLocalSocketPath,
  getPadiServeSocketPath,
  setLocalSocketPath,
} from "./daemonStatus.ts";
import { withRestartClaim } from "./endpointClaim.ts";
import { startLinkLossHealer } from "./linkLoss.ts";
import {
  type ConvergeVerdict,
  convergeAndReconcile,
} from "./reconcileConverged.ts";
import { localKavalDriver } from "./localDriver.ts";

type Identity = PtyHostIdentity;

// kaval's declaration into the shared daemon-convergence kit now lives in kaval
// itself (`kavalConvergencePolicy`, imported above): juspay/kolu#2101 gave kaval a
// SECOND supervisor — its own `--stdio` front converges before it relays — and a
// policy two supervisors must agree on cannot live inside one of them. The
// rationale for its two arms travelled with it.

/** The kolu app version stamped as `TERM_PROGRAM_VERSION` on every spawned PTY.
 *  INJECTED at boot by {@link setSpawnServerVersion} rather than read from a
 *  bundled `package.json`: padi's own `package.json` version (0.1.0) is NOT the
 *  app version, so reading it would corrupt the identity — kolu-server injects
 *  its `serverVersion` (the single source of truth) instead, keeping the
 *  dependency arrow out of `packages/server`.
 *
 *  `undefined` until boot injects it: a READ before the set is a boot-order bug,
 *  so {@link requireSpawnServerVersion} crashes loudly rather than stamping a
 *  spawned PTY with an unset/stale version. */
let spawnServerVersion: string | undefined;

/** The injected app version, or a loud crash if a spawn is composed before boot
 *  set it. Fail-fast: a never-set read must surface, not silently stamp a blank
 *  `TERM_PROGRAM_VERSION`.
 *
 *  Called by {@link buildTerminalSpawnInput}, which gathers ALL the daemon's own
 *  facts into a {@link TerminalEnvSpec}; `composeSpawnInput` reads the spec and
 *  no globals. Exported so the boot-order guard can be pinned directly — its
 *  sibling guard (the kaval socket) throws first inside the gatherer, so there is
 *  no path that reaches this one through the public function. */
export function requireSpawnServerVersion(): string {
  if (spawnServerVersion === undefined) {
    throw new Error(
      "spawnServerVersion read before setSpawnServerVersion() — kolu-server boot must inject it before ensureLocalEndpoint",
    );
  }
  return spawnServerVersion;
}

/** Inject the kolu app version used for the spawned PTY's identity env. Called
 *  once at boot, BEFORE {@link ensureLocalEndpoint}. */
export function setSpawnServerVersion(v: string): void {
  if (!v) throw new Error("setSpawnServerVersion: empty");
  spawnServerVersion = v;
}

/** padi's kaval endpoint, as the supervisor types it. */
type KavalEndpoint = Endpoint<PtyHostClient, Identity, KavalConnectionMetadata>;

/** The endpoint AND its serialized restart trigger, as ONE value.
 *
 *  They are held together because they must be REPLACED together: `serializeRestart`
 *  carries the coalescing/emit-guard state for the endpoint it was built over, so an
 *  endpoint swapped without its trigger (or vice versa) would coalesce a restart onto
 *  a daemon nobody holds. Two independent `let`s could express that drift; one value
 *  cannot. */
interface HeldEndpoint {
  readonly endpoint: KavalEndpoint;
  readonly restart: <Ctx>(
    steps: RestartSteps<PtyHostClient, Identity, Ctx, KavalConnectionMetadata>,
  ) => Effect.Effect<void, unknown>;
}

/**
 * padi's pty-host endpoint STATE — the three module-level `let`s this file used to
 * carry (`endpoint`, `triggerRestart`, `infoPromise`), as one named service over
 * two `Ref` cells.
 *
 * Why a `Context.Service` and not three `let`s: the state now has an IDENTITY (the
 * key below) that padi's boot Layer graph can provide, and the endpoint + its
 * restart trigger are one atomically-swapped value rather than two cells a caller
 * could half-update. Why the module still holds ONE instance instead of reading it
 * out of an Effect context: every consumer of `ptyHostClient` is synchronous domain
 * code deep inside non-Effect call stacks (padi-B1 §1.2), so the reads are
 * `Ref.getUnsafe` — a cell read, no fiber, and no new `Effect.run*` edge (PLAN #25).
 * `Ref` is what makes those reads honest: the cell is named, its writes go through
 * `MutableRef.set` on the same cell, and nothing outside this module can alias it.
 */
class PtyHostEndpointState extends Context.Service<
  PtyHostEndpointState,
  {
    /** The held endpoint + trigger, or honest absence before boot / while down. */
    readonly current: Ref.Ref<HeldEndpoint | undefined>;
    /** Run a serialized restart against whatever is held; dies when nothing is. */
    readonly restart: <Ctx>(
      steps: RestartSteps<
        PtyHostClient,
        Identity,
        Ctx,
        KavalConnectionMetadata
      >,
    ) => Effect.Effect<void, unknown>;
    /** The host facts, fetched once and cached for the PROCESS (see below). */
    readonly info: Effect.Effect<PtyHostSystemInfo, unknown>;
  }
>()("padi/ptyHost/PtyHostEndpointState") {}

/** Set a `Ref` from synchronous, non-Effect code. `Ref.set` is an `Effect`; the
 *  cell under it is a plain `MutableRef`, and writing it directly is what keeps
 *  this module's two writers (boot and the test seam) off an `Effect.run*` edge
 *  they would otherwise have to open for a single assignment. */
function setRef<A>(ref: Ref.Ref<A>, value: A): void {
  MutableRef.set(ref.ref, value);
}

const heldEndpoint: Ref.Ref<HeldEndpoint | undefined> = Ref.makeUnsafe<
  HeldEndpoint | undefined
>(undefined);

/** Host facts (shell, home, platform, rcDir) read once per process and cached —
 *  constant for the daemon's life. The in-flight READ is cached (not its value),
 *  as the FIBER running it, so concurrent first spawns join one round-trip instead
 *  of each opening their own. A failed read stays cached exactly as the rejected
 *  promise did: every later spawn joins the same failed fiber rather than silently
 *  re-dialling a daemon that just said no.
 *
 *  Deliberately NOT invalidated on a recycle, and that is not an oversight: every
 *  field kaval reports here is derived from its daemon HOME (`rcDir` is
 *  `home.file("rc")`) or from the machine, both of which a recycle at the same
 *  rendezvous preserves. Clearing it would buy a redundant round-trip on the first
 *  spawn after every restart. */
const cachedInfo: Ref.Ref<Fiber.Fiber<PtyHostSystemInfo, unknown> | undefined> =
  Ref.makeUnsafe<Fiber.Fiber<PtyHostSystemInfo, unknown> | undefined>(
    undefined,
  );

/** The one instance. `PtyHostEndpointState` is also the `Context` key, so a future
 *  boot graph can PROVIDE this value; nothing here reads it out of a context,
 *  because the readers are not Effects. */
const endpointState = PtyHostEndpointState.of({
  current: heldEndpoint,
  restart: (steps) =>
    Effect.suspend(() => {
      const held = Ref.getUnsafe(heldEndpoint);
      if (held === undefined) {
        // A DEFECT, as the synchronous throw it replaces was: restarting before
        // boot is an ordering bug in the caller, not a failure the surface
        // declares.
        throw new Error("kaval endpoint not initialized — cannot restart");
      }
      return held.restart(steps);
    }),
  // `forkDetach`, not `forkChild`: the read must outlive whichever spawn happened
  // to ask first, because a second spawn may already be joined to it. And because
  // `forkDetach` does not start the child until this fiber yields, the `setRef`
  // below lands before the read can complete and be joined — so two callers can
  // never each fork their own.
  info: Effect.gen(function* () {
    const existing = Ref.getUnsafe(cachedInfo);
    if (existing !== undefined) return yield* Fiber.join(existing);
    const fiber = yield* Effect.forkDetach(
      ptyHostClient.surface.system.info({}),
    );
    setRef(cachedInfo, fiber);
    return yield* Fiber.join(fiber);
  }),
});

/** Install `ep` (and the restart trigger built over it) as the held endpoint.
 *
 *  The trigger is CLAIMED here, at the one place it is built, so every restart
 *  that reaches this endpoint takes the link-loss exclusion by construction and
 *  there is no unclaimed path to the trigger for a caller to forget. The claim is
 *  still taken synchronously before the trigger runs (`withRestartClaim`
 *  increments inside its `Effect.suspend`, before the trigger is entered), and it
 *  still happens BEFORE the trigger rather than around it, so the trigger's
 *  coalescing is untouched. */
function holdEndpoint(ep: KavalEndpoint): void {
  const trigger = serializeRestart(ep);
  setRef(endpointState.current, {
    endpoint: ep,
    restart: (steps) => withRestartClaim(trigger(steps)),
  });
}

/** Immutable identity of the kaval connection the endpoint owns right now.
 * Both fields come from that ONE connection: `pid` from its validated
 * `system.version` handshake and `startedAt` from the endpoint's own instance
 * identity. This metadata stays process-internal — never a padi/kaval wire
 * field. */
export type KavalProcessTarget = Readonly<{
  pid: number;
  startedAt: number;
}>;

/** The current endpoint-owned process target, or honest absence while kaval is
 * disconnected. Consumers capture this value before an async process read. */
export function currentKavalProcessTarget(): KavalProcessTarget | undefined {
  const connection = Ref.getUnsafe(endpointState.current)?.endpoint.current();
  return connection === undefined
    ? undefined
    : Object.freeze({
        pid: connection.metadata.pid,
        startedAt: connection.startedAt,
      });
}

/** The dispatch of the endpoint's current connection, or a thrown error if it
 *  isn't connected (before `ensureLocalEndpoint()`, or while the daemon is down —
 *  `degraded`). The face below resolves THIS on every call, so a reconnect (B3)
 *  is transparent to every holder.
 *
 *  The throw is EAGER on purpose: it happens as the member is invoked, before any
 *  Promise or Stream exists, which is the shape `resubscribeStream`'s guard
 *  (`terminalEndpoint/local.ts`) is written against — a daemon-down subscribe is a
 *  synchronous throw it catches as a drop, never an escaping rejection. */
function liveDispatch(): SurfaceDispatch {
  const conn = Ref.getUnsafe(endpointState.current)?.endpoint.current();
  if (!conn) {
    throw new Error(
      "pty-host endpoint is not connected — the kaval daemon is starting or down",
    );
  }
  return conn.metadata.dispatch;
}

/** The pty-host client `LocalTerminalEndpoint` (and this module) consume — ONE
 *  face, built at import time over a dispatch that RESOLVES the endpoint's current
 *  connection per call. So a captured `ptyHostClient` reference never goes stale
 *  across a daemon recycle, and it is the framework's own spec-derived face
 *  (`ptyHostClientOver`) rather than a hand-rolled forwarding Proxy: the member
 *  set, the tags and the input decoding are exactly the live client's, because it
 *  is built by the same walk. */
export const ptyHostClient: PtyHostClient = ptyHostClientOver({
  unary: (tag, payload) => liveDispatch().unary(tag, payload),
  stream: (tag, payload) => liveDispatch().stream(tag, payload),
});

/** TEST-ONLY: install a fake endpoint (and its serialized restart trigger) so an
 *  integration test can drive the REAL `restartLocalDaemon` / `ptyHostClient`
 *  without a live kaval — the same wiring `ensureLocalEndpoint` sets at boot. */
export function __setEndpointForTest(ep: KavalEndpoint): () => void {
  const previous = Ref.getUnsafe(endpointState.current);
  holdEndpoint(ep);
  return () => {
    setRef(endpointState.current, previous);
  };
}

/** Boot the local pty-host endpoint under the always-recycle policy and connect.
 *  SUCCEEDS whether or not the daemon came up — a boot failure reports `dead`
 *  via `onStatus` and leaves `ptyHostClient` throwing, so the server can still
 *  listen and the UI honestly shows the dead/degraded state (never a crash, never
 *  an import-time throw). That is what the `never` error channel says.
 *
 *  This boot is NOT re-cast as a typed pipeline (unlike `runPadiDaemon`, L16): its
 *  step order is already enforced by DATA FLOW, not prose. `ep = createEndpoint(...)`
 *  produces the value `convergeAndReconcile(ep, …)` takes, and its
 *  `onAdopted`/`onHealed`/`onNotAdopted` branches consume — you cannot converge or
 *  reconcile before the endpoint exists, because there is no `ep` to pass. There is no side-effecting "must run before X"
 *  ordering here for a token to guard, so the same shape read as a latent hazard in
 *  `runPadiDaemon` (setters with no data edge between them) is a non-issue here. */
export function ensureLocalEndpoint(opts: {
  /** Primary kaval home — built by the caller via {@link padiKavalHome} (or a
   *  test fixture). Gate and socket co-located; never loose path strings. */
  home: DaemonHomePaths;
  /** LEGACY per-port kaval home the BINDER hints (W2.2 upgrade bridge). Absent
   *  for a standalone padi — never adopts a stray port kaval. SPAWN stays the
   *  primary home, so a later recycle converges off the hint. */
  legacyHome?: DaemonHomePaths;
  onStatus: (
    hostId: string,
    status: EndpointStatus<Identity, KavalConnectionMetadata>,
  ) => void;
  /** Run after the boot ADOPTS a surviving daemon (B3.3) — reconcile its live
   *  PTYs against the saved session. Injected (not imported) so this composition
   *  root stays free of the terminal-endpoint layer, which imports back from
   *  here. Skipped on a fresh / recycled boot (no survivors to reconcile). */
  onAdopted?: Effect.Effect<void, unknown>;
  /** The heal's counterpart to {@link onAdopted} — run when a MID-SESSION
   *  re-converge adopts the daemon it had lost the link to (juspay/kolu#2182).
   *  REQUIRED, and separate from `onAdopted` rather than defaulting to it,
   *  because the two answer different questions over different premises: boot
   *  adoption reconciles a SAVED SESSION into an empty registry, while a heal
   *  meets a full registry that is itself the truth and needs only its taps
   *  re-wired. A heal that ran the boot's hook would rewind every terminal's
   *  chrome to the last autosave — and persist it. Optionality here would make
   *  that regression a missing argument away, so there is no default. */
  onHealed: Effect.Effect<void, unknown>;
  /** Run on the NO-SURVIVOR boot — a fresh / recycled daemon where nothing live
   *  survives (adoption reported `false`), OR after a failed adoption forces a
   *  recycle. PARKS the saved session (W1.R6): seeds a parked registry entry per
   *  saved active record so the restore card shows and `session.restore` can
   *  re-spawn them. Injected for the same reason as `onAdopted` (keep this root
   *  free of the terminal-endpoint layer). Replaces the old no-op that left the
   *  saved session untouched for the client to respawn. */
  onNotAdopted?: () => void;
  /** Run after the boot try/catch settles, REGARDLESS of outcome — NOT on
   *  connection. Even when the daemon came up `dead` this fires; the name says
   *  "boot settled," not "connected," precisely because there is no connection
   *  event to honor here. Used to start live inventory discovery (B3.5):
   *  subscribe to the daemon's `inventory` feed so a PTY created OUT-OF-BAND (a
   *  `kaval-tui create` against the same daemon) is adopted while kolu runs, not
   *  just at the next boot. Injected (not imported) for the same reason as
   *  `onAdopted`. Given a process-lifetime signal; the reconciler re-subscribes
   *  across daemon recycles until it aborts (and absorbs a dead-on-boot daemon
   *  the same way — it simply waits, then picks up once the daemon connects). */
  onBootSettled?: (signal: AbortSignal) => void;
  /** Stamp the PROVEN recovery after the self-healing re-converge restored a
   *  link that died mid-session (#2182), told WHICH recovery the converge
   *  settled on (#2184). The verdict is the whole message: `adopted` re-made the
   *  link to a daemon that never stopped serving, while `no-survivors` /
   *  `recycled` mean a fresh daemon and a parked session — one signal each, since
   *  only the latter is what `startKavalSupervision`'s `onRecovered` proves.
   *  Injected for the same reason as the hooks above: the status store is the
   *  caller's to write, so this composition root never imports it. */
  onRecovered: (verdict: ConvergeVerdict) => void;
  /** Is our kaval still serving? The self-healing re-converge's precondition
   *  (#2184) — REQUIRED, because a healer without one re-converges blind, and a
   *  blind converge SPAWNS when nobody is home, which turns a lost link into an
   *  unledgered restart loop. What each answer means to the healer is on
   *  `startLinkLossHealer`'s `stillServing`.
   *
   *  INJECTED rather than read here: the reading is `observeHeldKaval`'s — the
   *  one both supervision arms take — and taking it from the composition root
   *  that already holds both keeps this root free of the sensor. */
  stillServing: Effect.Effect<KavalObservation["kind"]>;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { home, legacyHome } = opts;
    // Surface where this kaval listens, so the dialog can show it (and `kaval-tui`
    // users can target it explicitly). Set before the endpoint's first status emit —
    // the primary home by default; the adopt-hint flips it to the legacy socket
    // when an upgrade adopts the port kaval, and a spawn resets it back.
    setLocalSocketPath(home.socketPath);
    // Refresh baked identity at boot (staleKey is process-constant, but keep the
    // policy object the single source — bake is already fixed on the const above).
    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    // The self-healing arm (#2182), constructed BEFORE the endpoint because it is
    // wired into that endpoint's own status emit. `Effect.suspend` is what lets it
    // name `ep` here: the re-converge is a DESCRIPTION, and nothing runs it until
    // a link dies — long after this line has bound the reference.
    const healer = startLinkLossHealer({
      // The heal converges with the SAME endpoint and the same no-survivor park,
      // but its adopt arm is `onHealed`, never the boot's `onAdopted`. Adoption
      // asks "what was running before I existed?" — a question only the saved
      // session can answer, and one a heal already knows the answer to, because
      // its registry never emptied. Handing a heal the boot's answer is how a
      // repair rewinds a user's chrome to the last autosave and persists it.
      reconverge: Effect.suspend(() =>
        convergeAndReconcile(ep, {
          ...opts,
          onAdopted: opts.onHealed,
          // A heal never recycles on an unfinished re-wire — see `onAdoptFailure`.
          onAdoptFailure: "report",
        }),
      ),
      stillServing: opts.stillServing,
      onRecovered: opts.onRecovered,
    });
    const ep = createEndpoint<PtyHostClient, Identity, KavalConnectionMetadata>(
      {
        hostId: encodeHostLocation(LOCAL_LOCATION),
        home,
        // ONE axis — where this program's osfacts binary lives — resolved ONCE, at
        // composition, and bound to BOTH OS-fact injects: a missing bake is a loud
        // boot failure, never a surprise during a squatter recovery that is already
        // coping with a wedged endpoint. Two spellings of the env var and two
        // resolution timings on adjacent lines is how the two drift apart.
        readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
        readSocketHolders: osfactsSocketHolders(osfactsBin),
        policy: kavalConvergencePolicy(),
        probe: (socketPath) => probeKavalForConvergence(socketPath),
        driver: localKavalDriver(home.socketPath),
        // the framework hands you the path
        connect: (path) => connectKaval(path),
        log,
        // Intercepted, never intercepted-away: the healer OBSERVES every status
        // (it only re-reads a cell and arms a timer — the emit is synchronous, so
        // nothing may run converge on this stack) and the caller's subscriber
        // then gets the status unchanged.
        onStatus: (hostId, status) => {
          healer.observe(status.state);
          opts.onStatus(hostId, status);
        },
        // The W2.2 upgrade bridge (only when the binder hinted a legacy home):
        // if the digest gate is empty but a COMPATIBLE pre-W2.2 kaval is alive at the
        // port socket, ADOPT it and RECORD it as this kaval's live location (so spawned
        // PTYs' `KAVAL_SOCKET` and the daemon dialog point at the adopted daemon). SPAWN
        // stays the primary home, so `onSpawned` resets the recorded location on the
        // recycle that converges the migration.
        adoptHint:
          legacyHome === undefined
            ? undefined
            : {
                home: legacyHome,
                connect: (path) => connectKaval(path),
                onAdopted: () => setLocalSocketPath(legacyHome.socketPath),
              },
        onSpawned: () => setLocalSocketPath(home.socketPath),
      },
    );
    holdEndpoint(ep);
    // The whole boot, absorbed: the endpoint has already reported `dead` by the time
    // anything here fails, so a failure must not crash the server boot. `catchCause`
    // rather than `catch` because a DEFECT in the boot (a bug in a reconcile hook) is
    // exactly as unfit to take the process down as a declared failure — the UI's job
    // is to show `dead`, not to disappear.
    yield* Effect.catchCause(
      Effect.gen(function* () {
        // The only boot verb: policy is fixed on the endpoint; no fence, no
        // budget, no boot-method choice at the call site. And the same verb the
        // mid-session heal takes (#2182) — converge, then the adopt /
        // no-survivor / fail-closed-recycle branches — so a heal reconciles
        // exactly as a boot does.
        yield* convergeAndReconcile(ep, {
          ...opts,
          // The BOOT fails closed: an unfinished reconcile may hide live PTYs.
          onAdoptFailure: "recycle",
        });
      }),
      (cause) =>
        Effect.sync(() => {
          // The endpoint already reported `dead`; don't crash the server boot.
          log.error(
            { err: Cause.squash(cause) },
            "kaval endpoint failed to come up at boot",
          );
        }),
    );

    // Boot settled (success OR `dead`) — run whatever the caller hooked here. Used
    // to start live inventory discovery (B3.5), which runs whatever the boot
    // outcome: if the daemon is down, the reconciler's re-subscribe loop simply
    // waits and picks up once it connects; if a survivor was adopted above, its
    // snapshot is already-known terminals (idempotent no-ops). The signal is
    // process-lifetime — never aborted today (no shutdown hook; the per-terminal
    // taps live the same way), so the loop runs until the process ends and
    // survives daemon recycles.
    opts.onBootSettled?.(new AbortController().signal);
  });
}

/** Run a serialized, session-preserving restart of the local kaval endpoint
 *  (B3.2). The caller (`restartLocal.ts`, the soul) supplies the restart steps —
 *  capture the session, drain the terminals, recycle, reattach — and this
 *  forwards them through the endpoint's coalescing + emit-guard trigger. Dies
 *  if the endpoint hasn't been booted yet (`ensureLocalEndpoint` not run).
 *
 *  The one entry every restart takes — the "Restart kaval" button's RPC and the
 *  steady-state supervision auto-recycle both arrive here — and the link-loss
 *  healer's exclusion rides the trigger itself, claimed in {@link holdEndpoint}
 *  where the trigger is built. So no heal can start behind a restart, an attempt
 *  already mid-converge is waited out before the recycle begins, and this
 *  function has no claim to remember. */
export function restartLocalEndpoint<Ctx>(
  steps: RestartSteps<PtyHostClient, Identity, Ctx, KavalConnectionMetadata>,
): Effect.Effect<void, unknown> {
  return endpointState.restart(steps);
}

// ── Spawn policy (kolu's soul) — unchanged from the in-process inversion,
//    only now composed against the DAEMON's system.info over the wire ─────────

/**
 * What this daemon must put in a terminal's environment for the terminal to
 * reach back at it — the spawn policy's *what*, as one value.
 *
 * Every member is a fact only the running daemon holds (the sockets it serves
 * on, the toolchain from its own build), which is why they are handed to the
 * composer as data rather than read from globals inside it: `composeSpawnInput`
 * stays pure and the set is enumerable in one place instead of growing another
 * positional parameter each time a terminal needs to know one more thing about
 * its host. `buildTerminalSpawnInput` is the one place the values are gathered.
 */
export interface TerminalEnvSpec {
  /** The kaval this terminal will live in — stamped as `KAVAL_SOCKET`. */
  kavalSocket: string;
  /** The padi that owns it — stamped as `PADI_SOCKET` when known. */
  padiSocket?: string;
  /** Tool dirs to put on `PATH`, highest priority first; `[]` when this daemon
   *  was never baked with a toolchain. Required, with `[]` as the honest empty:
   *  the only producer (`readAgentToolsBake`) cannot return `undefined`, so an
   *  optional marker would add a representable state that means nothing.
   *  (`padiSocket?` is genuinely optional — its producer really can be unset.) */
  toolsPath: readonly string[];
  /** The kolu-server version this daemon reports — stamped as
   *  `TERM_PROGRAM_VERSION`. A daemon fact like the rest, so the composer reads
   *  it off the spec rather than off a module global. */
  serverVersion: string;
}

/**
 * Compose the fully-specified spawn input the pty-host wire expects, from kolu's
 * spawn policy applied against the host's facts. Pure (no IO): the env is
 * layered least → most authoritative —
 *   1. `cleanEnv()`        — the canonical SPAWN_ENV_ALLOWLIST composed from the
 *      parent env (a clean base, NOT a wholesale passthrough — #1872).
 *   2. `koluIdentityEnv()` — kolu's identity vars (stomp parent).
 *   3. `plan.env`          — per-PTY overrides (e.g. ZDOTDIR for zsh).
 *   4. `KAVAL_TERMINAL_ID` — this terminal's own id, so a process inside can name
 *      itself (the self-knowledge twin of `KAVAL_SOCKET`). Like `KAVAL_SOCKET`, the
 *      direct assignment overwrites any inherited value, so a nested terminal
 *      re-owns its own id rather than leaking the outer one.
 *   5. `KAVAL_SOCKET`      — daemon locator (the `$TMUX` convention): the socket
 *      THIS kaval serves on, passed in as data (`kavalSocket`). It shares no key
 *      with the layers above, so its position is immaterial; it's assigned last
 *      only to read as the outermost fact. Lets a process INSIDE the spawned
 *      terminal (an agent driving its siblings) reach the daemon that owns it
 *      without scanning `/tmp` — and, on macOS where `$XDG_RUNTIME_DIR` is unset,
 *      without guessing the port-namespaced path at all.
 *   6. `PATH` + `KOLU_TERMINAL_TOOLS_PATH` — the daemon's own client toolchain
 *      (`spec.toolsPath`). The locators above only pay off if the tools that
 *      READ them can be run: a socket in the env is useless to an agent whose
 *      shell has no `padi-tui` and no `kolu` to speak it. This is the one layer
 *      that MERGES with (rather than stomps) what came before — the dirs are
 *      prepended to the inherited `PATH`, so the user's own tools all still
 *      resolve, kolu's just win a name collision.
 *
 * **Local-host only, today.** The host this process talks to IS this machine, so
 * `cleanEnv()`'s `env.SHELL`/`env.HOME` (describing *this* machine) win, and
 * `system.info`'s shell/home are the fallback when the local env omits them
 * (e.g. systemd user services). `system.info.rcDir` (the host-side init-file
 * dir) is consumed unconditionally — the host owns that disk. A remote host
 * (R-2) must invert this `cleanEnv()`-wins layering; until then, local-only.
 */
export function composeSpawnInput(
  args: { id: string; cwd?: string },
  info: PtyHostSystemInfo,
  spec: TerminalEnvSpec,
): PtyHostSpawnInput {
  const env = cleanEnv();
  const shell = env.SHELL ?? info.shell;
  const home = env.HOME ?? info.home;
  const cwd = args.cwd || home || "/";
  Object.assign(env, koluIdentityEnv(spec.serverVersion));
  const plan = prepareShellInit({
    shell,
    home,
    terminalId: args.id,
    rcDir: info.rcDir,
  });
  Object.assign(env, plan.env);
  // (rationale in docblock item 4). Two facts not captured there: it's assigned
  // directly, not via prepareShellInit's plan.env, so it reaches even a shell we
  // don't wrap — the id is a fact about the terminal, not the shell; and it is the
  // AUTHORITATIVE source of the id (a fact about THIS terminal), assigned here rather
  // than inherited. Post-#1872, cleanEnv composes from the allowlist, which carries no
  // KAVAL_* key, so any ambient KAVAL_TERMINAL_ID is already dropped upstream — this
  // stamp doesn't need to STOMP an inherited value, it simply IS the value.
  // Pairs as `kaval-tui snapshot "$KAVAL_TERMINAL_ID" --socket "$KAVAL_SOCKET"`.
  env[CONTAINING_TERMINAL_ENV] = args.id;
  env.KAVAL_SOCKET = spec.kavalSocket;
  // The toolchain (docblock item 6). Two assignments, one fact: the dirs go on
  // PATH for anything the terminal runs, and the joined value is stamped under
  // its own name so the wrapper rcfile can re-assert it after the user's
  // dotfiles replay (an absolute `export PATH=…` there would otherwise drop it —
  // see kolu-pty's PATH_REASSERT). Both are skipped when there are no dirs, so a
  // from-source daemon spawns exactly the env it does today.
  //
  // Stamped under the TERMINAL name, never the BAKE name a wrapper writes: a
  // kolu launched from inside this terminal must not read the stamp as its own
  // build's toolchain. See kolu-pty's two constants.
  if (spec.toolsPath.length > 0) {
    env.PATH = prependPathEntries(env.PATH, spec.toolsPath);
    env[TERMINAL_TOOLS_PATH_ENV] = spec.toolsPath.join(":");
  }
  // The $KAVAL_SOCKET twin for padi: a `padi-tui` INSIDE this terminal reaches the
  // padi that OWNS it (the daemon that spawned it) with no --socket/--state-root —
  // so the /kolu agent-drives-agent loop runs `padi-tui wait` flagless. Stamped
  // only when known (padi's own serving socket, recorded at boot); an absent value
  // just makes padi-tui autodiscover, so this never blocks a spawn.
  if (spec.padiSocket !== undefined) env.PADI_SOCKET = spec.padiSocket;
  return {
    id: args.id,
    argv: [shell, ...plan.args],
    cwd,
    env,
    initFiles: plan.initFiles,
    // The per-terminal headless-mirror depth — kaval owns this number (the
    // mirror lives there), so we send its `DEFAULT_MIRROR_SCROLLBACK`, the SAME
    // value kaval-tui's spawn path falls back to. Deliberately smaller than the
    // client's visible scrollback (kolu-common's `DEFAULT_SCROLLBACK`): the
    // conflated 50K mirror × unbounded live terminals was the OOM. See
    // `docs/atlas/src/content/atlas/kaval-heap-oom.mdx`.
    scrollback: DEFAULT_MIRROR_SCROLLBACK,
  };
}

/** `composeSpawnInput` against the daemon's cached `system.info`, stamped with the
 *  socket THIS endpoint booted on so every terminal carries `KAVAL_SOCKET`. */
export function buildTerminalSpawnInput(args: {
  id: string;
  cwd?: string;
}): Effect.Effect<PtyHostSpawnInput, unknown> {
  return Effect.gen(function* () {
    // A terminal can only be spawned once the endpoint is up, which records the
    // socket at boot (`ensureLocalEndpoint` → `setLocalSocketPath`), so an unset
    // value here is an ordering bug — crash loud rather than ship a broken
    // `KAVAL_SOCKET`. Guarded at the point of use, like `liveClient` /
    // `restartLocalEndpoint` guard the endpoint's other boot-set singletons.
    const kavalSocket = getLocalSocketPath();
    if (kavalSocket === undefined) {
      throw new Error(
        "local kaval socket path read before the endpoint recorded it at boot",
      );
    }
    // The rest of the spec is gathered here — the one place the daemon's own facts
    // are collected — so `composeSpawnInput` stays a pure function of its inputs.
    //
    // padi's own serving socket is recorded at boot by `daemonMain`
    // (`setPadiServeSocketPath`) and stamped as `PADI_SOCKET`. Optional (see
    // `getPadiServeSocketPath`) — an unset value just omits the locator and padi-tui
    // autodiscovers, so no boot-order guard here (unlike the required KAVAL socket).
    // `readAgentToolsBake()` needs no guard for the opposite reason: a from-source
    // daemon has no baked toolchain and says so by returning `[]`.
    //
    // `requireSpawnServerVersion()` DOES crash on an unset read — the app version
    // is injected at boot and a blank `TERM_PROGRAM_VERSION` must not ship — and it
    // is gathered here with the rest, so the composer reads no globals of its own.
    return composeSpawnInput(args, yield* endpointState.info, {
      kavalSocket,
      padiSocket: getPadiServeSocketPath(),
      toolsPath: readAgentToolsBake(),
      serverVersion: requireSpawnServerVersion(),
    });
  });
}
