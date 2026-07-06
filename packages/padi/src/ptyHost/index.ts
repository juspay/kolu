/**
 * kolu-server's pty-host endpoint — the composition root for **the door** (B2).
 *
 * Before B2 this module constructed the pty-host IN-PROCESS at import time and
 * served it on a socket. Now the server is a *client* of a `kaval` daemon it
 * spawns: `ensureLocalEndpoint()` runs the always-recycle boot (kill any
 * survivor, spawn fresh, connect + handshake) through the supervisor spine
 * (`@kolu/surface-daemon-supervisor`), and `ptyHostClient` is a **stable
 * forwarding facade** over whatever connection the endpoint currently holds — so
 * `LocalTerminalEndpoint` keeps one import-time reference while the live socket
 * client is established asynchronously (no module-global host, no import-time
 * RPC). The spawn *policy* stays here, kolu's soul: `buildTerminalSpawnInput`
 * composes the env/identity/rcfile layers against the daemon's `system.info`,
 * exactly as before — only now over the wire.
 *
 * See `docs/atlas/src/content/atlas/pty-daemon.mdx` (B2 — the door).
 */

import {
  type ConvergencePolicy,
  converge,
  createBuildDrainFence,
  createEndpoint,
  daemonBuild,
  type Endpoint,
  type EndpointStatus,
  outcomeAdopted,
  type RestartSteps,
  serializeRestart,
} from "@kolu/surface-daemon-supervisor";
import {
  currentPtyHostIdentity,
  DEFAULT_MIRROR_SCROLLBACK,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostClient,
  type PtyHostIdentity,
  type PtyHostSpawnInput,
  type PtyHostSystemInfo,
} from "kaval";
import { cleanEnv, koluIdentityEnv, prepareShellInit } from "kolu-pty";
import { log } from "../log.ts";
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
import { kavalGatePath, localKavalDriver } from "./localDriver.ts";

type Identity = PtyHostIdentity | undefined;

/** The single local kaval host's id — the daemon-status key the endpoint reports
 *  under and consumers (e.g. boot adoption's `setAdoptedCount`) read by. Owned
 *  here, where `ensureLocalEndpoint` defines the daemon's identity/lifecycle.
 *  This is a *daemon* identity (the kaval host), distinct from a terminal's
 *  `location` (a `HostLocation` DU in kolu-common); a terminal placed on the
 *  local endpoint carries `{ kind: "local" }`, not this string. */
export const LOCAL_HOST_ID = "local";

/**
 * kaval's declaration into the shared daemon-convergence kit (`converge`). kaval is
 * NON-DRAINABLE — recycling it kills its PTYs (no graceful drain verb), so:
 *   - `onContractSkew: recycle` — a wire-incompatible survivor can't serve the new
 *     supervisor, so kill + respawn (its PTYs die, unavoidable at a wire break). This is
 *     the recycle-on-skew arm, byte-identical to the pre-kit `adoptOrEnsure`: the kit
 *     routes a `recycle` decision straight back to `adoptOrEnsure`.
 *   - `onBuildMismatch: nudge-human` — a same-contract build change is NOT auto-acted on
 *     (draining/recycling would cost live PTYs); the kit reports the mismatch as an
 *     outcome and takes no supervisor action. kaval's "update available" nudge stays a
 *     human decision, surfaced by padi serving `expectedKaval` + the running identity for
 *     the client's `kavalStale` to compare — unchanged.
 * Being non-drainable, kaval CANNOT spell a drain policy (Pin 1 — a compile error).
 */
const KAVAL_CONVERGENCE_POLICY: ConvergencePolicy<"not-drainable"> = {
  capability: "not-drainable",
  onContractSkew: { kind: "recycle" },
  onBuildMismatch: { kind: "nudge-human" },
};

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

/** The injected app version, or a loud crash if a spawn composed before boot set
 *  it. Fail-fast: a never-set read must surface, not silently stamp a blank
 *  `TERM_PROGRAM_VERSION`. */
function requireSpawnServerVersion(): string {
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

let endpoint:
  | Endpoint<PtyHostClient, Identity, KavalConnectionMetadata>
  | undefined;

/** The serialized, emit-guarded restart trigger, bound to the live endpoint by
 *  `ensureLocalEndpoint`. Held here (not rebuilt per call) so its coalescing
 *  state is shared: concurrent restart requests ride one in-flight recycle. The
 *  soul's restart steps reach it through `restartLocalEndpoint`. */
let triggerRestart:
  | (<Ctx>(
      steps: RestartSteps<
        PtyHostClient,
        Identity,
        Ctx,
        KavalConnectionMetadata
      >,
    ) => Promise<void>)
  | undefined;

/** The live socket client, or a thrown error if the endpoint isn't connected
 *  (before `ensureLocalEndpoint()`, or while the daemon is down — `degraded`).
 *  The facade resolves THIS on every call, so a reconnect (B3) is transparent
 *  to every holder. */
function liveClient(): PtyHostClient {
  const conn = endpoint?.current();
  if (!conn) {
    throw new Error(
      "pty-host endpoint is not connected — the kaval daemon is starting or down",
    );
  }
  return conn.client;
}

/** Build a stable object that forwards every nested call to whatever the
 *  endpoint's current connection is. `ptyHostClient.surface.terminal.spawn(x)`
 *  resolves the live client at call time, so a captured reference never goes
 *  stale across a daemon recycle. Symbols (e.g. an accidental `await`) resolve
 *  to undefined so the facade is never mistaken for a thenable. */
function makeForwardingClient(getRoot: () => PtyHostClient): PtyHostClient {
  const build = (path: PropertyKey[]): unknown =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (typeof prop === "symbol") return undefined;
        return build([...path, prop]);
      },
      apply(_t, _thisArg, args) {
        const leaf = path[path.length - 1];
        if (leaf === undefined) {
          throw new Error("pty-host client facade invoked as a value");
        }
        // Walk to the leaf's parent on the LIVE client, then call it with the
        // parent as `this` (oRPC namespaces are plain nested objects).
        // biome-ignore lint/suspicious/noExplicitAny: dynamic forward over the contract client shape.
        let parent: any = getRoot();
        for (const key of path.slice(0, -1))
          parent = parent[key as PropertyKey];
        return parent[leaf](...args);
      },
    });
  return build([]) as PtyHostClient;
}

/** The pty-host client `LocalTerminalEndpoint` (and this module) consume — a
 *  stable facade over the endpoint's current daemon connection. */
export const ptyHostClient: PtyHostClient = makeForwardingClient(liveClient);

/** TEST-ONLY: install a fake endpoint (and its serialized restart trigger) so an
 *  integration test can drive the REAL `restartLocalDaemon` / `ptyHostClient`
 *  without a live kaval — the same wiring `ensureLocalEndpoint` sets at boot. */
export function __setEndpointForTest(
  ep: Endpoint<PtyHostClient, Identity, KavalConnectionMetadata>,
): void {
  endpoint = ep;
  triggerRestart = serializeRestart(ep);
}

/** Boot the local pty-host endpoint under the always-recycle policy and connect.
 *  Resolves whether or not the daemon came up — a boot failure reports `dead`
 *  via `onStatus` and leaves `ptyHostClient` throwing, so the server can still
 *  listen and the UI honestly shows the dead/degraded state (never a crash, never
 *  an import-time throw).
 *
 *  This boot is NOT re-cast as a typed pipeline (unlike `runPadiDaemon`, L16): its
 *  step order is already enforced by DATA FLOW, not prose. `ep = createEndpoint(...)`
 *  produces the value `converge({ endpoint: ep })` and the `onAdopted`/`onNotAdopted`
 *  branches consume — you cannot converge or reconcile before the endpoint exists,
 *  because there is no `ep` to pass. There is no side-effecting "must run before X"
 *  ordering here for a token to guard, so the same shape read as a latent hazard in
 *  `runPadiDaemon` (setters with no data edge between them) is a non-issue here. */
export async function ensureLocalEndpoint(opts: {
  /** The exact socket this endpoint's kaval serves and is dialed on — resolved by
   *  the caller. The padi process passes its digest-keyed
   *  `padiKavalSocketPath(stateRoot)` (`kaval-<digest>/pty-host.sock`); a test may
   *  pass any pinned path. One resolved string, so the boot is caller-agnostic — no
   *  port or digest assumption survives here. */
  kavalSocket: string;
  /** The LEGACY per-port kaval socket the BINDER hints (its OWN listen port's
   *  `kaval-<port>/pty-host.sock`) — the W2.2 upgrade bridge. On the first W2.2 boot,
   *  if this padi's digest-keyed kaval gate is empty but a COMPATIBLE pre-W2.2 kaval
   *  is alive here, ADOPT it (so its live PTYs survive the upgrade) instead of
   *  spawning a fresh one and leaking it. Absent for a STANDALONE padi (no binder, no
   *  hint) — which therefore never adopts a stray port kaval (e.g. a dev instance at
   *  another port). SPAWN stays digest-keyed, so a later recycle converges off it. */
  legacyKavalSocket?: string;
  onStatus: (
    hostId: string,
    status: EndpointStatus<Identity, KavalConnectionMetadata>,
  ) => void;
  /** Run after the boot ADOPTS a surviving daemon (B3.3) — reconcile its live
   *  PTYs against the saved session. Injected (not imported) so this composition
   *  root stays free of the terminal-endpoint layer, which imports back from
   *  here. Skipped on a fresh / recycled boot (no survivors to reconcile). */
  onAdopted?: () => Promise<void>;
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
}): Promise<void> {
  const socketPath = opts.kavalSocket;
  const legacyKavalSocket = opts.legacyKavalSocket;
  // Surface where this kaval listens, so the dialog can show it (and `kaval-tui`
  // users can target it explicitly). Set before the endpoint's first status emit —
  // the digest socket by default; the adopt-hint below flips it to the legacy socket
  // when an upgrade adopts the port kaval, and a spawn resets it back.
  setLocalSocketPath(socketPath);
  const ep = createEndpoint<PtyHostClient, Identity, KavalConnectionMetadata>({
    hostId: LOCAL_HOST_ID,
    gatePath: kavalGatePath(socketPath),
    socketPath,
    driver: localKavalDriver(socketPath),
    connect: () => connectKaval(socketPath),
    log,
    onStatus: opts.onStatus,
    // The W2.2 upgrade bridge (only when the binder hints a legacy port socket):
    // if the digest gate is empty but a COMPATIBLE pre-W2.2 kaval is alive at the
    // port socket, ADOPT it and RECORD it as this kaval's live location (so spawned
    // PTYs' `KAVAL_SOCKET` and the daemon dialog point at the adopted daemon). SPAWN
    // stays the digest socket, so `onSpawned` resets the recorded location on the
    // recycle that converges the migration.
    adoptHint:
      legacyKavalSocket === undefined
        ? undefined
        : {
            gatePath: kavalGatePath(legacyKavalSocket),
            socketPath: legacyKavalSocket,
            connect: () => connectKaval(legacyKavalSocket),
            onAdopted: () => setLocalSocketPath(legacyKavalSocket),
          },
    onSpawned: () => setLocalSocketPath(socketPath),
  });
  endpoint = ep;
  triggerRestart = serializeRestart(ep);
  try {
    // The boot, B3.3: adopt-or-recycle, now DELEGATED to the shared convergence kit
    // under kaval's declared {@link KAVAL_CONVERGENCE_POLICY} (recycle-on-skew +
    // nudge-human). The kit probes the running kaval's identity over `system.version`
    // (Pin 3), decides, and enacts through the endpoint's EXISTING boot methods — a
    // `recycle` decision routes straight to `adoptOrEnsure`, so a contract skew still
    // kills + respawns exactly as before, and a compatible survivor (same OR different
    // build) is ADOPTED (its PTYs preserved). A same-contract build change comes back as
    // `mismatch-reported` and takes NO supervisor action — kaval's currency nudge stays
    // the human's call, served for the client to compare (unchanged). We map the outcome
    // back to the `adopted` boolean the reconcile below already consumes.
    const outcome = await converge({
      endpoint: ep,
      baked: {
        contractVersion: PTY_HOST_CONTRACT_VERSION,
        build: daemonBuild(currentPtyHostIdentity().staleKey),
      },
      probe: () => probeKavalForConvergence(socketPath),
      policy: KAVAL_CONVERGENCE_POLICY,
      // kaval never build-drains (nudge-human), so the fence is unused here — but the kit
      // requires one; a fresh per-boot fence is the honest, inert value.
      buildFence: createBuildDrainFence(),
      log,
    });
    const adopted = outcomeAdopted(outcome);
    if (adopted && opts.onAdopted) {
      try {
        await opts.onAdopted();
      } catch (err) {
        // Reconciliation failed AFTER we adopted the survivor's connection — the
        // daemon is connected but holds PTYs kolu may not have registered (F3).
        // Fail CLOSED: recycle the daemon (kill + spawn fresh) so those hidden
        // PTYs are destroyed and the user's saved session falls back to the
        // restore card, rather than leaving invisible live terminals behind it.
        log.error(
          { err },
          "surviving-session reconciliation failed — recycling the adopted daemon",
        );
        await ep.ensure();
        // The recycle spawned a FRESH daemon — nothing live survives now, so this
        // is the no-survivor path: park the saved session for the restore card.
        opts.onNotAdopted?.();
      }
    } else if (!adopted) {
      // Fresh / recycled boot — no survivors. Park the saved session so the
      // restore card can re-spawn it (W1.R6, replacing the old no-op).
      opts.onNotAdopted?.();
    }
  } catch (err) {
    // The endpoint already reported `dead`; don't crash the server boot.
    log.error({ err }, "kaval endpoint failed to come up at boot");
  }

  // Boot settled (success OR `dead`) — run whatever the caller hooked here. Used
  // to start live inventory discovery (B3.5), which runs whatever the boot
  // outcome: if the daemon is down, the reconciler's re-subscribe loop simply
  // waits and picks up once it connects; if a survivor was adopted above, its
  // snapshot is already-known terminals (idempotent no-ops). The signal is
  // process-lifetime — never aborted today (no shutdown hook; the per-terminal
  // taps live the same way), so the loop runs until the process ends and
  // survives daemon recycles.
  opts.onBootSettled?.(new AbortController().signal);
}

/** Run a serialized, session-preserving restart of the local kaval endpoint
 *  (B3.2). The caller (`restartLocal.ts`, the soul) supplies the restart steps —
 *  capture the session, drain the terminals, recycle, reattach — and this
 *  forwards them through the endpoint's coalescing + emit-guard trigger. Throws
 *  if the endpoint hasn't been booted yet (`ensureLocalEndpoint` not run). */
export function restartLocalEndpoint<Ctx>(
  steps: RestartSteps<PtyHostClient, Identity, Ctx, KavalConnectionMetadata>,
): Promise<void> {
  if (!triggerRestart) {
    throw new Error("kaval endpoint not initialized — cannot restart");
  }
  return triggerRestart(steps);
}

// ── Spawn policy (kolu's soul) — unchanged from the in-process inversion,
//    only now composed against the DAEMON's system.info over the wire ─────────

/** Host facts (shell, home, platform, rcDir) read once per process and cached —
 *  constant for the daemon's life. The promise is cached (not its value) so
 *  concurrent first spawns share a single round-trip. */
let infoPromise: Promise<PtyHostSystemInfo> | undefined;
function hostInfo(): Promise<PtyHostSystemInfo> {
  infoPromise ??= ptyHostClient.surface.system.info({});
  return infoPromise;
}

/**
 * Compose the fully-specified spawn input the pty-host wire expects, from kolu's
 * spawn policy applied against the host's facts. Pure (no IO): the env is
 * layered least → most authoritative —
 *   1. `cleanEnv()`        — parent env passthrough (Nix devshell filter).
 *   2. `koluIdentityEnv()` — kolu's identity vars (stomp parent).
 *   3. `plan.env`          — per-PTY overrides (e.g. ZDOTDIR for zsh).
 *   4. `KAVAL_SOCKET`      — daemon locator (the `$TMUX` convention): the socket
 *      THIS kaval serves on, passed in as data (`kavalSocket`). It shares no key
 *      with the layers above, so its position is immaterial; it's assigned last
 *      only to read as the outermost fact. Lets a process INSIDE the spawned
 *      terminal (an agent driving its siblings) reach the daemon that owns it
 *      without scanning `/tmp` — and, on macOS where `$XDG_RUNTIME_DIR` is unset,
 *      without guessing the port-namespaced path at all.
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
  kavalSocket: string,
  padiSocket?: string,
): PtyHostSpawnInput {
  const env = cleanEnv();
  const shell = env.SHELL ?? info.shell;
  const home = env.HOME ?? info.home;
  const cwd = args.cwd || home || "/";
  Object.assign(env, koluIdentityEnv(requireSpawnServerVersion()));
  const plan = prepareShellInit({
    shell,
    home,
    terminalId: args.id,
    rcDir: info.rcDir,
  });
  Object.assign(env, plan.env);
  env.KAVAL_SOCKET = kavalSocket;
  // The $KAVAL_SOCKET twin for padi: a `padi-tui` INSIDE this terminal reaches the
  // padi that OWNS it (the daemon that spawned it) with no --socket/--state-root —
  // so the /kolu agent-drives-agent loop runs `padi-tui wait` flagless. Stamped
  // only when known (padi's own serving socket, recorded at boot); an absent value
  // just makes padi-tui autodiscover, so this never blocks a spawn.
  if (padiSocket !== undefined) env.PADI_SOCKET = padiSocket;
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
export async function buildTerminalSpawnInput(args: {
  id: string;
  cwd?: string;
}): Promise<PtyHostSpawnInput> {
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
  // padi's own serving socket, recorded at boot by `daemonMain`
  // (`setPadiServeSocketPath`), stamped as `PADI_SOCKET`. Optional (see
  // `getPadiServeSocketPath`) — an unset value just omits the locator and padi-tui
  // autodiscovers, so no boot-order guard here (unlike the required KAVAL socket).
  return composeSpawnInput(
    args,
    await hostInfo(),
    kavalSocket,
    getPadiServeSocketPath(),
  );
}
