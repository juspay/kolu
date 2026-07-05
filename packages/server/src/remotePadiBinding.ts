/**
 * kolu-server's REMOTE padi binder — W3.1, the ssh arm of {@link BoundPadi}.
 *
 * The local binder ({@link ./padiBinding.ts}) spawns/adopts a padi PROCESS on THIS
 * host over a unix socket. The remote binder does the byte-identical thing one ssh
 * hop away: it fronts a padi on another machine, provisioning it with Nix, and
 * re-serves its `padiSurface` to browsers through the SAME {@link reServeSurface}
 * seam. The knob {@link KOLU_PADI_HOST} picks which arm runs — unset → local
 * (byte-identical to today), set → the whole canvas becomes the remote host.
 *
 * Nothing here is remote-SPECIFIC machinery reinvented: the transport, closure
 * provisioning, reconnect, and liveness watchdog are `@kolu/surface-nix-host`'s
 * `getHostSession` (the exact stack `kaval-tui --host` rides for a bare kaval); the
 * durable-daemon front is `frontDaemonOverStdio` (the remote runs `padi --stdio`,
 * which adopt-or-spawns padi and relays its socket over the ssh byte channel, so
 * the padi it fronts — and its kaval, and the PTYs — outlives the link); the dial
 * judgement (control-core `hello` + typed skew refusal) is `@kolu/padi/dial`'s,
 * re-run here over the ssh-bridged link instead of a local socket.
 *
 * ADOPT-OR-SPAWN + RE-ADOPT come for free from the stack: kill the remote padi and
 * `frontDaemonOverStdio` spawns a fresh one on the next reconnect; restart
 * kolu-server and it re-adopts the still-running remote daemon (its PTYs never
 * died). #1313 still holds — a mere dial never kills a running padi; only its own
 * supervisor drains it, and `drainBoundPadi` (the "restart" verb) does that over
 * the frozen control core.
 *
 * ── The ssh-user 0700 caveat (carried over from the kaval-sessions era) ──
 * The remote padi runs AS THE SSH USER: `ssh <host> padi --stdio` executes under
 * whatever account the ssh identity authenticates as, and padi (like kaval) serves
 * its socket in a `0700` owner-only runtime dir keyed by a digest of ITS state-root
 * — so the SSH identity IS the daemon owner. Two hosts, or two ssh users on one
 * host, get two isolated padis by construction; a user who cannot reach the owner's
 * `0700` dir cannot reach the daemon. This is enforced on the REMOTE (padi/kaval
 * refuse to serve on a non-private dir — `serveOverSocket`), not asserted from
 * here: kolu-server never crosses the boundary. Pick your ssh user deliberately —
 * it decides who owns the host's terminals.
 */

import { currentPadiBuildId } from "@kolu/padi/assembly";
import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
  type PadiHello,
} from "@kolu/padi/surface";
import {
  type PadiDaemonClient,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi/dial";
import {
  DaemonContractSkewError,
  decide,
} from "@kolu/surface-daemon-supervisor";
import {
  getHostSession,
  type HostSessionState,
  type RemoteMirrorSession,
  ResolveDrvError,
  resolveSystem,
} from "@kolu/surface-nix-host";
import type { PadiConvergence } from "kolu-common/surface";
import type { BoundPadi } from "./padiBinding.ts";
// padi's convergence policy — ONE declaration, carved into padiConvergence.ts by L6 and
// consumed by BOTH arms: the local binder feeds it to the kit's `converge()`, and this
// remote arm feeds it to the kit's pure `decide()` (L23). No second policy table.
import { PADI_CONVERGENCE_POLICY } from "./padiConvergence.ts";
import { log } from "./log.ts";

/** How long the build/contract-mismatch drain waits for the ssh-bridged link to
 *  die (the daemon to exit) before treating the drain as not-taken — the
 *  transport-adapted twin of the local `DRAIN_TEARDOWN_CEILING_MS`. Sized above the
 *  local 2s because each liveness poll is a full ssh round-trip; a real drain exits
 *  well within it. Never a kill either way. */
const REMOTE_DRAIN_TEARDOWN_CEILING_MS = 6000;
/** Poll cadence for the post-drain liveness check (an ssh `control.core.hello`
 *  round-trip each tick). */
const REMOTE_DRAIN_POLL_MS = 150;
/** How many times a SINGLE build-mismatched padi instance may be drained before the
 *  binder gives up and degrades LOUDLY. Bounds a flapping ssh link (where each drain's
 *  "exit" is really a transient link blip and the SAME instance keeps coming back) so
 *  it converges to a loud degraded state instead of re-draining forever — small,
 *  because a genuine drain takes on the first attempt. */
const MAX_BUILD_DRAINS_PER_INSTANCE = 3;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** The per-system `{ system → padi .drv }` map env var, baked onto kolu-server's
 *  Nix wrapper (`koluBin` in default.nix). Named ONCE as a constant so the literal
 *  in errors and the `process.env[…]` read can't drift. Same shape as
 *  `KAVAL_AGENT_DRVS_JSON` (the kaval-tui precedent); `"{}"` / unset means the
 *  server was not built with the map — a remote binding is impossible, fail loud. */
const PADI_AGENT_DRVS_ENV = "PADI_AGENT_DRVS_JSON";

/** The host-selection knob: an ssh host (an `~/.ssh/config` alias or `user@host`).
 *  Unset → the LOCAL padi binding (byte-identical to today). Set → bind THAT host's
 *  padi over ssh; the whole canvas becomes it. Off by default, no UI — the picker
 *  is W3.2. */
export const KOLU_PADI_HOST_ENV = "KOLU_PADI_HOST";

/** Read the host-selection knob, or `undefined` when unset/blank (→ local arm). */
export function remotePadiHost(): string | undefined {
  const host = process.env[KOLU_PADI_HOST_ENV]?.trim();
  return host ? host : undefined;
}

/** Parse + validate the baked `{ system → padi .drv }` map EAGERLY — the STATIC-
 *  config axis, decided ONCE at bind time and never re-run on reconnect. A missing
 *  (`"{}"` / unset) or malformed map is a BUILD defect (kolu-server was not run from
 *  its Nix wrapper, which bakes the map), so it throws a PLAIN loud Error that crashes
 *  boot — NOT a deferred `ResolveDrvError` the `HostSession` would retry
 *  MAX_CONSECUTIVE_FAILURES times before tripping to terminal `failed`, silently
 *  degrading the whole canvas. Fail-fast per conventions.md, matching mini-ci's eager
 *  `connect()` env check and `dialAgentOnce`'s eager `parseDrvBySystem`. */
function parsePadiDrvMap(): Record<string, string> {
  const raw = process.env[PADI_AGENT_DRVS_ENV]?.trim();
  if (!raw || raw === "{}") {
    throw new Error(
      `${PADI_AGENT_DRVS_ENV} is not baked — a remote padi binding (${KOLU_PADI_HOST_ENV}) needs kolu-server run from its Nix wrapper, which bakes the arch-keyed padi drv map. Unset ${KOLU_PADI_HOST_ENV} to bind the local padi.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${PADI_AGENT_DRVS_ENV} is not a valid { system → drv } JSON map: ${(err as Error).message}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    // A truthy NON-string value (e.g. {"x86_64-linux": 42}) is an `object` that
    // slips the shape guard and would be handed back as a bogus `.drv` by the
    // `map[system]` lookup (its `!drv` check passes for a number). Reject it here,
    // eagerly, mirroring parseDrvBySystem's per-value guard
    // (@kolu/surface-nix-host/dialAgentOnce.ts).
    Object.values(parsed).some((v) => typeof v !== "string")
  ) {
    throw new Error(
      `${PADI_AGENT_DRVS_ENV} is not a { system → drv string } JSON object`,
    );
  }
  return parsed as Record<string, string>;
}

/** Build the `resolveDrvPath` thunk `getHostSession` runs at the top of EVERY spawn:
 *  probe the remote arch (`resolveSystem`, an ssh round-trip) and pick the baked padi
 *  `.drv` for it from the ALREADY-VALIDATED map. kaval rides INSIDE padi's closure
 *  (`KOLU_KAVAL_BIN` is baked in padi's wrapper), so this ONE drv provisions both
 *  daemons. Only the genuinely PER-HOST axis lives here — the static-config axis (map
 *  present / valid JSON / right shape) is decided eagerly by {@link parsePadiDrvMap}.
 *  A host whose arch has no baked drv is a TERMINAL config fault (`ResolveDrvError`
 *  with `"remote"` → the session gives up loudly rather than retrying an unwinnable
 *  spawn forever); it stays deferred because it genuinely needs the arch probe. An
 *  unreachable host makes `resolveSystem` reject plainly → the session reads that as
 *  `"network"` and retries until the host is back. */
function makeResolvePadiDrv(
  host: string,
  map: Record<string, string>,
): () => Promise<string> {
  return async () => {
    const system = await resolveSystem(host);
    const drv = map[system];
    if (!drv) {
      throw new ResolveDrvError(
        `no padi derivation baked for system=${system} (${PADI_AGENT_DRVS_ENV} has: ${Object.keys(map).join(", ") || "none"})`,
        "remote",
      );
    }
    return drv;
  };
}

/** The bound padi's honest identity, read off the control-core `hello` on each
 *  fresh spawn — the same three facts the local {@link PadiBindingSession} tracks.
 *  `null` while unbound (the honest "unknown"). */
interface RemotePadiIdentity {
  surfaceVersion: string;
  commit: string | null;
  startedAt: number | null;
}

/** The padi's bind outcome as ONE named state. A single discriminated field makes the
 *  illegal "both an identity AND a skew" combination unrepresentable. Two of the states
 *  hold a LIVE client (canvas works) — `bound` (converged) and `adoptedStale` (rode a
 *  build-mismatched survivor); the rest hold no live client (canvas dead / warming). The
 *  degraded ones (adoptedStale / skew / unconverged / linkFailed) each surface a
 *  {@link PadiConvergence} descriptor so the Padi dialog shows WHY, never a silent swallow. */
type BindState =
  | { kind: "unbound" }
  | { kind: "bound"; identity: RemotePadiIdentity }
  // ADOPT-LOUDLY: a build-mismatched survivor we could NOT drain-replace within M1's
  // bounded budget (a contested host respawning the old build). We RIDE the resident
  // daemon — canvas WORKS, connection stays `connected` — and surface the mismatch as a
  // standing state. This is the parity twin of the LOCAL kit's fence-spent→adopt row.
  | {
      kind: "adoptedStale";
      identity: RemotePadiIdentity;
      runningBuild: string;
      expectedBuild: string;
      detail: string;
    }
  // An INCOMPATIBLE padiSurface contract (binder OLDER) we won't adopt — REFUSED, canvas
  // dead. The client is rejected; the connection cell reads a loud degraded/skew frame.
  | { kind: "skew"; error: string }
  // A newer-contract drain that never provably took (a flapping/wedged ssh link) — we
  // cannot speak the incompatible surface AND could not drain it away. Canvas dead.
  | { kind: "unconverged"; error: string }
  // The ssh link gave up (host unreachable / provisioning/resolve failed) — the terminal
  // HostSession `failed` frame, captured so the dialog shows the REASON, not a bare dot.
  | { kind: "linkFailed"; error: string };

/** {@link RemotePadiSession.admitDrain}'s verdict: drain this instance (with the attempt
 *  number), or GIVE UP draining it (with the reason). The caller decides what give-up
 *  MEANS per axis — the build axis ADOPTS the resident stale build (canvas works), the
 *  contract axis goes `unconverged` (an incompatible surface can't be adopted). */
type DrainAdmission =
  | { kind: "drain"; attempt: number }
  | { kind: "giveUp"; reason: string };

/** The convergence deps — the binder's side of the two-axis drain decision, and the
 *  instance-keyed drain budget. All default to the production values; injected in tests
 *  to drive the drain path without two real builds. */
export interface RemotePadiSessionDeps {
  /** The binder's `padiSurface` version (the contract axis's "us" side). */
  binderVersion?: string;
  /** The binder's expected padi build id — the baked, ARCH-INDEPENDENT `PADI_BUILD_ID`
   *  source hash (so a binder built for arch A and the remote padi built for arch B
   *  agree iff their source matches). `""` for an off-nix binder that cannot judge
   *  builds. Default {@link currentPadiBuildId}. */
  binderBuildId?: string;
  /** Per-instance build-drain budget (test hook) — default
   *  {@link MAX_BUILD_DRAINS_PER_INSTANCE}. Lowered in tests to reach the loud-degraded
   *  exhaustion path without many rounds. */
  maxBuildDrainsPerInstance?: number;
  /** Post-drain fail-fast window / poll cadence (test hooks) — default the module
   *  constants sized for the ssh leg. */
  drainTeardownCeilingMs?: number;
  drainPollMs?: number;
}

/**
 * The ssh arm of {@link BoundPadi}: adapts a `@kolu/surface-nix-host` `HostSession`
 * (already a `RemoteMirrorSession`, so the transport/reconnect are its problem)
 * into the padi-shaped session `reServeSurface` + kolu-server consume. It does the
 * two padi-specific things the generic HostSession does not:
 *
 *   1. **control-core handshake + skew refusal** — on each fresh spawn it reads the
 *      combined client's `control.core.hello()` (identity + versions) and runs the shared
 *      kit's pure `decide()` over padi's policy to converge / adopt / refuse it, exactly the
 *      table the local arm's `connectPadi`→`converge()` runs over a local socket. A refusal
 *      REJECTS the mirrored client
 *      so the pump's cursor keeps waiting (`waitForNextClient` swallows it — no
 *      crash, no spin) and the connection cell reads a loud degraded/skew state,
 *      never a silent "connected but empty". This is the local arm's REFUSE, over
 *      ssh — never a kill (#1313).
 *   2. **scope + drain** — `reServeSurface` mirrors `.surface.padi.<member>`, so
 *      `pin`/`currentClient` yield `scopePadiSurface(combined)` (the padi sibling),
 *      while `drainBoundPadi` keeps the COMBINED client to reach `control.core.drain`.
 */
export class RemotePadiSession implements BoundPadi {
  private destroyed = false;
  /** The binder's contract version + expected build id + the instance-keyed drain
   *  tracker — the "us" side of a convergence that now runs the SAME shared `decide()` table as
   *  the LOCAL arm, over ONE `PADI_CONVERGENCE_POLICY` (see {@link handshakeAndScope}); L23
   *  deleted the hand-mirrored cascade. The two visible differences that remain are the
   *  transport's, not the policy's: this arm ADOPTS LOUDLY (surfaces the degraded state) where
   *  local adopts silently, and its drain-detection is instance-keyed (ssh has no socket-close
   *  signal). */
  private readonly binderVersion: string;
  private readonly binderBuildId: string;
  private readonly maxDrainsPerInstance: number;
  private readonly drainCeilingMs: number;
  private readonly drainPollMs: number;
  /** Instance-keyed build-drain state (NOT a global boolean fence). `drainedInstance`
   *  is the `startedAt` of the padi instance we are converging this boot; `drainAttempts`
   *  is how many drains that SAME instance has survived. Over ssh a `hello()` rejection
   *  can be a link BLIP rather than a daemon exit (the local arm's socket-CLOSE event
   *  has no ssh twin), so a once-per-boot boolean would falsely "spend" on a blip and
   *  then silently adopt the stale build FOREVER. Keying by instance lets us re-drain
   *  the SAME never-exited instance (a blip) while still refusing to treadmill a
   *  DIFFERENT instance (the two-supervisor / absent-id-dev-loop livelock the fence
   *  guards). Persists across reconnects; reset only when a matched build is adopted.
   *  L23 kept this instance-keyed guard as the remote arm's fence when it moved the DECISION
   *  onto the shared `decide()`: the kit's once-per-boot boolean fence assumes a socket-close
   *  signal ssh does not have, so `decide()` runs with `buildFenceSpent: false` and this guard
   *  owns the drain budget instead. */
  private drainedInstance: number | null = null;
  private drainAttempts = 0;
  /** The HostSession's last link frame — seeded by the first (synchronous)
   *  snapshot-then-delta `onState` fire in the constructor; the default below only
   *  bridges the microscopic gap before it. */
  private hostState: HostSessionState = {
    connection: "connecting",
    progressLines: [],
    remoteProgressLines: [],
    lastError: null,
    failureCause: null,
  };
  private readonly hostUnsub: () => void;
  private readonly stateListeners = new Set<(s: HostSessionState) => void>();

  /** The padi's bind outcome — one named state, not two parallel nullables. `bound`
   *  carries the identity read off the last successful `hello`; `skew` carries the
   *  loud degraded frame's error when the handshake found a padiSurface version this
   *  kolu-server can't speak (overlaying the transport-level "connected" the
   *  HostSession would otherwise report). Both fall back to `unbound` when the link
   *  drops (a respawned padi is a fresh process) or the handshake re-runs on a fresh
   *  spawn. */
  private bindState: BindState = { kind: "unbound" };

  /** Memoize the scoped+handshaked client per HOST spawn: keyed by the host's
   *  `currentClient()` promise IDENTITY (the same axis `makeClientCursor` advances
   *  on), so the `hello` handshake runs exactly ONCE per spawn and the cursor sees
   *  a stable promise until a genuinely new spawn appears. */
  private memoKey: Promise<unknown> | null = null;
  private memoScoped: Promise<PadiSurfaceClient> | null = null;

  constructor(
    private readonly host: RemoteMirrorSession<PadiDaemonContract>,
    private readonly hostName: string,
    deps: RemotePadiSessionDeps = {},
  ) {
    this.binderVersion = deps.binderVersion ?? PADI_SURFACE_VERSION;
    this.binderBuildId = deps.binderBuildId ?? currentPadiBuildId();
    this.maxDrainsPerInstance =
      deps.maxBuildDrainsPerInstance ?? MAX_BUILD_DRAINS_PER_INSTANCE;
    this.drainCeilingMs =
      deps.drainTeardownCeilingMs ?? REMOTE_DRAIN_TEARDOWN_CEILING_MS;
    this.drainPollMs = deps.drainPollMs ?? REMOTE_DRAIN_POLL_MS;
    // HostSession.onState is snapshot-then-delta: the first fire below runs
    // synchronously and seeds `hostState`, then every transition tracks it.
    this.hostUnsub = host.onState((s) => {
      this.hostState = s;
      // A dropped link invalidates identity + any bind verdict (the next spawn may differ)
      // and the memoized client (its promise is dead). Transient warming (copying/connecting)
      // leaves a just-read identity in place, matching the local arm's "clear on
      // degraded/dead only". A TERMINAL `failed` (the HostSession gave up — unreachable
      // host / provisioning-resolve failure; rare once markConnected resets the budget) is
      // captured as a STANDING `linkFailed` carrying the reason, so the dialog shows WHY the
      // canvas is dark instead of a bare disconnected dot.
      if (s.connection === "failed") {
        this.bindState = {
          kind: "linkFailed",
          error:
            s.lastError ??
            "the remote ssh link failed and gave up (host unreachable / provisioning failed)",
        };
        this.memoKey = null;
        this.memoScoped = null;
      } else if (s.connection === "disconnected") {
        this.bindState = { kind: "unbound" };
        this.memoKey = null;
        this.memoScoped = null;
      }
      this.fire();
    });
  }

  pin(): Promise<PadiSurfaceClient> {
    // Kick the host spawn + parent-lifetime hold (bumps refCount so the reconnect
    // loop keeps retrying). The pump discards this result and drives off
    // `currentClient()`; return the scoped client for symmetry with the local arm.
    void this.host.pin().catch(() => {
      // A spawn failure surfaces through onState (copying/connecting → disconnected)
      // and the reconnect loop; nothing to do with the rejection here.
    });
    return (
      this.currentClient() ??
      Promise.reject(new Error("remote padi not connected yet"))
    );
  }

  currentClient(): Promise<PadiSurfaceClient> | null {
    if (this.destroyed) return null;
    const combinedP = this.host.currentClient();
    if (combinedP === null) return null;
    if (combinedP !== this.memoKey) {
      this.memoKey = combinedP;
      this.memoScoped = this.handshakeAndScope(combinedP);
      // P1: when a FRESH spawn arrives while a prior degraded verdict still stands (a
      // `linkFailed` that a `failed → re-arm` recovery hasn't cleared, say), the guard below
      // returns null and the pump never awaits THIS `memoScoped` — so a rejecting handshake
      // (e.g. the fresh spawn is a skew) would be an UNHANDLED rejection, which index.ts's
      // handler turns into a fatal `process.exit(1)`. Attach a swallow so the promise always
      // has a handler; the pump, when it DOES consume `memoScoped`, awaits its own copy
      // independently (a promise can carry many handlers), so this never hides a rejection the
      // pump needs — it only defuses the floated one.
      void this.memoScoped.catch(() => {});
    }
    // A standing skew / unconverged / linkFailed REFUSED this spawn (canvas dead) —
    // `handshakeAndScope` set the degraded bindState and REJECTED `memoScoped`. Return null
    // (honest "no live client") so a consumer that polls off a LIVE client —
    // `readPadiMemoryOnce` (index.ts) — reads the SAME three-way `absent` the local arm does
    // (it nulls its own client), instead of awaiting a rejected promise into a 'poll failed'
    // + `log.error` EVERY 5s forever while the transport stays up. `adoptedStale` is
    // DELIBERATELY absent here — it holds a LIVE resident client (canvas works), so it falls
    // through and returns the scoped client; its degradation rides `boundPadi.convergence`.
    if (
      this.bindState.kind === "skew" ||
      this.bindState.kind === "unconverged" ||
      this.bindState.kind === "linkFailed"
    ) {
      return null;
    }
    return this.memoScoped;
  }

  /**
   * The control-core `hello` handshake over a fresh spawn's combined client, then the shared
   * kit's PURE `decide()` over padi's `PADI_CONVERGENCE_POLICY` — the SAME table the LOCAL arm
   * runs (L23 deleted the hand-mirrored cascade). `decide()` keys on the two identities (this
   * binder's baked `{contract, build}` vs the running padi's off the hello) and the switch below
   * ENACTS its verdict; only the enactment is remote-specific:
   *
   *   Axis 1 — CONTRACT (`padiSurface` version): skew + binder NEWER → DRAIN
   *   (newest-wins, instance-keyed bounded); skew + binder OLDER → REFUSE (never drain).
   *   Axis 2 — BUILD (same contract; #1670): a different OR absent `buildId` is a
   *   MISMATCH → DRAIN (instance-keyed, bounded per {@link admitDrain}); a matched /
   *   off-nix build ADOPTS; a drain we could not win (budget spent / wedged link) →
   *   ADOPT-LOUDLY the resident build (see {@link adoptStale}).
   *
   * Two transport-adaptations from the local arm, both because a DRAIN here tears down the
   * SAME link this handshake rode — this is why the remote arm consumes `decide()` but NOT the
   * kit's `converge()` enactment (which drives local-endpoint boot methods ssh has no analog of):
   *   (a) on a successful drain we REJECT (the cursor waits) and the HostSession's own
   *       reconnect respawns this binder's closure (the exact drain→respawn the pu-box run
   *       proves) — where the local arm's separate `adoptOrSpawnOrRefuse` spawns.
   *   (b) when a build drain does NOT provably take (a flapping link, or a contested host
   *       respawning the old build), BOTH arms hold the same OUTCOME POLICY — ADOPT the
   *       resident stale build (the local kit's fence-spent→adopt row; here
   *       {@link adoptStale}) so the canvas WORKS. The visible difference is this arm adopts
   *       LOUDLY (surfaces a standing `boundPadi.convergence` state) where local adopts
   *       silently — surfacing local convergence is a follow-up beyond L23's narrow cut (the
   *       kit collapses the stale-vs-fresh distinction its adopt would need). The
   *       DRAIN-DETECTION differs too (an instance-keyed budget of {@link admitDrain}, since ssh
   *       has no socket-close signal — so `decide()` runs with `buildFenceSpent: false` and
   *       `admitDrain` owns the budget), but the exhausted-row policy is identical. An
   *       INCOMPATIBLE CONTRACT is the one thing neither arm can ride, so a contract drain that
   *       does not take goes {@link unconverged}, not adopt. A drain that does not take is NEVER
   *       a kill.
   */
  private handshakeAndScope(
    combinedP: Promise<unknown>,
  ): Promise<PadiSurfaceClient> {
    return combinedP.then(async (raw) => {
      const combined = raw as PadiDaemonClient;
      const hello = await combined.surface.control.core.hello();
      const running = hello.surfaceVersion;

      // The hello roundtripped — the FIRST RPC on this spawn — so signal the
      // HostSession that the link is live NOW, before we decide adopt/drain/refuse.
      // This is load-bearing for convergence, NOT just the adopt path: markConnected
      // resets the HostSession's bounded give-up budget AND makes a subsequent child
      // exit classify as a retry-forever "network" fault (it exits `wasConnected`)
      // rather than a bounded "remote" one. Without it, an INTENDED convergence drain
      // — which REJECTS the mirrored client, so the pump never folds a frame and never
      // calls markConnected itself — would count its own clean child-exit against the
      // give-up budget and, after a few prior failures (e.g. the host was briefly
      // unreachable at boot), trip the session to terminal `failed` with the OLD padi
      // drained and NO new build ever respawned. The LOCAL arm drives its own gateless
      // reconnect, so a local drain always respawns; this restores that guarantee here.
      // markConnected self-guards on `connecting`, so the pump's later onFirst call is
      // a harmless no-op.
      this.host.markConnected();

      // The bound padi's INSTANCE identity (its boot time) — the key BOTH convergence
      // axes track their drain by (see {@link admitDrain}), so a blip-induced re-drain of
      // the same never-exited instance is told apart from a two-supervisor treadmill
      // spawning fresh wrong instances.
      const instance = hello.startedAt ?? null;

      const runningBuild = hello.buildId ?? "";

      // The POLICY DECISION now comes from the shared kit's PURE `decide()` — the SAME table
      // the LOCAL arm runs, over padi's `PADI_CONVERGENCE_POLICY` (carved into
      // `./padiConvergence.ts` by L6, so both arms consume ONE declaration). It keys on the two
      // identities: this binder's baked {contract, build} vs the running padi's read off its
      // control-core hello. This DELETES the hand-mirrored two-axis cascade; what stays is the
      // transport-specific ENACTMENT below — the instance-keyed drain fence ({@link admitDrain})
      // + adopt-loudly — because ssh has no socket-close signal the local kit's once-per-boot
      // boolean fence relies on (L23). `buildFenceSpent` is `false`: that once-per-boot boolean
      // is the LOCAL arm's, so `decide()` always yields the raw drain-vs-adopt policy here and
      // `admitDrain` owns whether to actually drain or adopt-loudly — keeping behaviour
      // byte-identical to the hand-rolled cascade this replaces (the decision leaves are the
      // very same `contractIsCompatible`/`contractIsNewer`/`buildIdMatches`).
      const decision = decide(
        { contractVersion: this.binderVersion, buildId: this.binderBuildId },
        { contractVersion: running, buildId: runningBuild },
        PADI_CONVERGENCE_POLICY,
        false,
      );

      // A LIVE survivor (the hello answered → `running` is non-null) under padi's policy can
      // only yield adopt / refuse / drain-and-replace. `spawn` (a null survivor), `recycle`
      // and `report-mismatch` (kaval's / the currency arms — padi declares neither) cannot
      // occur here; fail LOUD if the kit ever hands one over rather than silently mis-enacting.
      switch (decision.kind) {
        case "adopt":
          // Contract-compatible + build match (or an off-nix binder that can't judge builds) →
          // ADOPT. Reaching a matched build means any prior drain genuinely took (a fresh
          // instance replaced the drained one) — clear the instance tracker so a later genuine
          // mismatch starts its own budget fresh.
          this.drainedInstance = null;
          this.drainAttempts = 0;
          return this.adopt(combined, hello);

        case "refuse": {
          // Contract skew + this binder OLDER/behind → REFUSE, never drain (#1313 +
          // monotonicity): leave the survivor standing + degraded, upgrade kolu-server to converge.
          const msg = `padi contract skew: remote padi serves padiSurface ${running}, kolu-server needs ${this.binderVersion} — this binder is OLDER/behind, refusing`;
          log.warn(
            { host: this.hostName, binderVersion: this.binderVersion, running },
            "remote padi survivor is a padiSurface skew and this binder is OLDER/behind — " +
              "REFUSING (never draining a running padi; it is left standing + degraded). " +
              "Upgrade kolu-server to converge.",
          );
          return this.refuse(msg);
        }

        case "drain-and-replace":
          // The kit decided converge-by-draining; the AXIS picks the enactment (both
          // instance-keyed + bounded via {@link admitDrain}, differing only in the
          // after-budget outcome — an incompatible contract can't be ridden so it goes loud
          // `unconverged`; a build mismatch adopts the resident LOUDLY).
          return decision.axis === "contract"
            ? this.convergeNewerContract(combined, running, instance)
            : this.convergeBuildMismatch(
                combined,
                hello,
                running,
                runningBuild,
                instance,
              );

        default:
          throw new Error(
            `remote padi convergence: unreachable decision "${decision.kind}" for padi's policy with a live survivor`,
          );
      }
    });
  }

  /** ENACT a NEWER-contract drain (the kit's `decide()` returned drain-and-replace on the
   *  CONTRACT axis). Instance-keyed + BOUNDED via {@link admitDrain} — the contract axis has no
   *  once-per-boot fence, and because `markConnected` on the hello resets the give-up budget
   *  every cycle, a two-supervisor treadmill (the remote host's OWN older kolu-server respawning
   *  its old-contract padi after each drain) would otherwise drain forever. A treadmill (a
   *  DIFFERENT still-skewed instance) or budget exhaustion → LOUD terminal `unconverged`: an
   *  INCOMPATIBLE contract can never be adopted (unlike a build mismatch), so there is no working
   *  canvas to ride — the ONE row where the contract axis diverges from build's adopt-loudly. A
   *  drain that does not take is NEVER a kill. */
  private async convergeNewerContract(
    combined: PadiDaemonClient,
    running: string,
    instance: number | null,
  ): Promise<PadiSurfaceClient> {
    const admission = this.admitDrain(
      instance,
      `contract skew (binder ${this.binderVersion} newer than running ${running})`,
    );
    if (admission.kind === "giveUp") {
      // An INCOMPATIBLE contract can never be adopted (unlike a build mismatch), so a
      // treadmill/exhaustion here stays LOUD terminal `unconverged` (canvas dead until a
      // compatible padi wins) — the ONE row where the contract axis diverges from the build
      // axis's adopt-loudly: there is no working canvas to ride.
      return this.unconverged(admission.reason);
    }
    log.info(
      {
        host: this.hostName,
        binderVersion: this.binderVersion,
        running,
        instance,
        attempt: admission.attempt,
      },
      `remote padi is a padiSurface skew and this binder is NEWER — draining it (instance ` +
        `startedAt ${instance}, attempt ${admission.attempt}/${this.maxDrainsPerInstance}; persist + exit, its ` +
        `kaval + PTYs survive) so the reconnect respawns this binder's own newer closure`,
    );
    const contractDrain = await this.drainAndAwaitClose(combined);
    if (contractDrain.took) {
      // The reconnect brings up the newer closure; the cursor waits for it.
      throw new Error(
        "remote padi drained (newer contract) — reconnecting to the respawned newer build",
      );
    }
    // Ceiling: the skewed padi kept answering — it will not exit, and an INCOMPATIBLE contract
    // can never be adopted → LOUD terminal unconverged (no kill).
    return this.unconverged(
      `newer-binder drain did not take within ${this.drainCeilingMs}ms — the skewed padi kept ` +
        `answering (serves ${running}, kolu-server needs ${this.binderVersion})` +
        (contractDrain.drainRejection
          ? `; drain call rejected: ${contractDrain.drainRejection}`
          : ""),
    );
  }

  /** ENACT a build-mismatch drain (the kit's `decide()` returned drain-and-replace on the BUILD
   *  axis; #1670). Instance-keyed + BOUNDED via {@link admitDrain}: a blip-induced re-drain of
   *  the SAME never-exited instance is admitted, but a DIFFERENT still-mismatched instance (two
   *  supervisors / the absent-id dev loop) or one past its budget is the contested host we can't
   *  win by draining → ADOPT-LOUDLY the resident (canvas WORKS, mismatch surfaced as a standing
   *  state) — emergent owner/guest, parity with the local kit's fence-spent→adopt row. A drain
   *  that does not take is NEVER a kill. */
  private async convergeBuildMismatch(
    combined: PadiDaemonClient,
    hello: PadiHello,
    running: string,
    runningBuild: string,
    instance: number | null,
  ): Promise<PadiSurfaceClient> {
    const admission = this.admitDrain(
      instance,
      `build mismatch (running=${runningBuild} expected=${this.binderBuildId})`,
    );
    if (admission.kind === "giveUp") {
      // The M1 drain budget is spent — a CONTESTED host (another supervisor keeps respawning
      // the old build) we can't win by draining. ADOPT-LOUDLY: ride the resident daemon so the
      // canvas WORKS, surfacing the mismatch as a standing state. Emergent owner/guest: on a
      // solo host the first drain converges us as owner; here we yield and ride what's there.
      return this.adoptStale(combined, hello, runningBuild, admission.reason);
    }
    log.info(
      {
        host: this.hostName,
        binderBuildId: this.binderBuildId,
        runningBuild,
        running,
        instance,
        attempt: admission.attempt,
      },
      `padi build change on boot: running=${runningBuild} expected=${this.binderBuildId}` +
        ` — draining the survivor (instance startedAt ${instance}, attempt ${admission.attempt}/${this.maxDrainsPerInstance}; persist + exit, its kaval + PTYs survive) and respawning this binder's own build (drain-on-build-mismatch, #1670)`,
    );
    const buildDrain = await this.drainAndAwaitClose(combined);
    if (buildDrain.took) {
      // The link died within the window. EITHER the daemon exited (drain took → the reconnect
      // respawns a fresh instance whose build matches → adopts) OR a transient blip (the SAME
      // instance is re-adopted → we re-drain it, up to the budget). Reconnect + re-handshake
      // decides on the NEXT hello's startedAt — NEVER adopt on this reply.
      throw new Error(
        "remote padi drain / link death (build mismatch) — reconnecting to re-handshake the survivor",
      );
    }
    // The daemon kept ANSWERING past the teardown window — alive, did not exit (a wedged link).
    // We could not drain-replace it → ADOPT-LOUDLY the resident build. Never a silent stale adopt.
    return this.adoptStale(
      combined,
      hello,
      runningBuild,
      `remote padi drain did not take within ${this.drainCeilingMs}ms — the daemon kept answering (running=${runningBuild} expected=${this.binderBuildId})` +
        (buildDrain.drainRejection
          ? `; drain call rejected: ${buildDrain.drainRejection}`
          : ""),
    );
  }

  /** ADOPT a compatible survivor: record its honest identity and hand back the
   *  padi-scoped client the re-serve mirrors. */
  private adopt(
    combined: PadiDaemonClient,
    hello: PadiHello,
  ): PadiSurfaceClient {
    this.bindState = {
      kind: "bound",
      identity: {
        surfaceVersion: hello.surfaceVersion,
        commit: hello.commit || null,
        startedAt: hello.startedAt ?? null,
      },
    };
    this.fire();
    return scopePadiSurface(combined);
  }

  /** ADOPT-LOUDLY a build-mismatched survivor we could NOT drain-replace within M1's
   *  bounded budget (a wedged link, or a contested host respawning the old build). Ride the
   *  RESIDENT daemon — the canvas WORKS (a LIVE client; connection stays `connected`, so the
   *  re-served surface's `liveWhen` gate stays open) — and record a STANDING `adoptedStale`
   *  state carrying running-vs-expected build + a reason, surfaced via
   *  {@link padiConvergence} → `boundPadi.convergence` so the Padi dialog shows it (never a
   *  silent swallow). Loud: `log.warn` + the surfaced descriptor. This is the parity twin of
   *  the LOCAL kit's fence-spent→adopt row; the contract axis still refuses (an incompatible
   *  surface can't be ridden). */
  private adoptStale(
    combined: PadiDaemonClient,
    hello: PadiHello,
    runningBuild: string,
    reason: string,
  ): PadiSurfaceClient {
    const detail = `${reason} — riding the resident daemon; upgrade the winner or stop the respawner to converge`;
    log.warn(
      { host: this.hostName, runningBuild, expectedBuild: this.binderBuildId },
      `remote padi ADOPTED STALE (build mismatch, could not converge) — ${detail}`,
    );
    this.bindState = {
      kind: "adoptedStale",
      identity: {
        surfaceVersion: hello.surfaceVersion,
        commit: hello.commit || null,
        startedAt: hello.startedAt ?? null,
      },
      runningBuild,
      expectedBuild: this.binderBuildId,
      detail,
    };
    this.fire();
    return scopePadiSurface(combined);
  }

  /** REFUSE the survivor: flag the loud degraded/skew frame the connection cell
   *  reads, and REJECT so the pump's cursor keeps waiting (`waitForNextClient`
   *  swallows it — no crash, no spin), never a kill. */
  private refuse(msg: string): never {
    this.bindState = { kind: "skew", error: msg };
    this.fire();
    throw new DaemonContractSkewError(msg);
  }

  /** LOUD DEGRADED for the CONTRACT axis only — a NEWER-contract skew we could not drain
   *  away (the drain never provably took, or a treadmill of respawned wrong instances). An
   *  incompatible padiSurface can never be ADOPTED (unlike a build mismatch, which
   *  {@link adoptStale} rides), so there is no working canvas to keep: surface the reason in
   *  the connection cell (like {@link refuse}) AND at `log.error`, and REJECT the client so
   *  the pump keeps waiting. The local arm reaches the same verdict for an incompatible
   *  contract it can't drain — no fork. Distinct from `refuse` (a monotonicity refusal of an
   *  OLDER binder): a plain Error, not a skew error. */
  private unconverged(msg: string): never {
    log.error({ host: this.hostName }, `remote padi UNCONVERGED — ${msg}`);
    this.bindState = { kind: "unconverged", error: msg };
    this.fire();
    throw new Error(msg);
  }

  /** Instance-keyed drain ADMISSION — shared by BOTH convergence axes (contract + build),
   *  the ssh-transport-correct twin of the local arm's once-per-boot fence. Over ssh a
   *  `hello()` rejection can be a link BLIP, not an exit, so a global fence would falsely
   *  spend; and neither axis can self-terminate, because `markConnected` on the hello
   *  resets the give-up budget every cycle. So: re-draining the SAME never-exited instance
   *  (a blip) is admitted up to a per-instance budget; a DIFFERENT instance still wrong
   *  after a drain this boot (two supervisors fighting, or the absent-id dev loop) is the
   *  treadmill. Returns a {@link DrainAdmission} — the CALLER decides what "give up" means
   *  per axis (build ADOPTS the resident stale build; contract goes `unconverged`), so the
   *  M1 bound is shared but the after-budget OUTCOME is axis-specific. L23 moved the DECISION
   *  onto the shared `decide()` but kept this bound as the remote arm's fence — the kit's
   *  once-per-boot boolean assumes a socket-close signal ssh has no analog of. */
  private admitDrain(instance: number | null, why: string): DrainAdmission {
    if (this.drainedInstance !== null && instance !== this.drainedInstance) {
      return {
        kind: "giveUp",
        reason: `${why}: a DIFFERENT padi instance (startedAt ${instance}) is still wrong after draining ${this.drainedInstance} this boot — another supervisor is respawning it (anti-livelock)`,
      };
    }
    if (
      instance === this.drainedInstance &&
      this.drainAttempts >= this.maxDrainsPerInstance
    ) {
      return {
        kind: "giveUp",
        reason: `${why}: instance startedAt ${instance} survived ${this.drainAttempts} drain attempts without exiting — a flapping link / respawn loop that will not converge`,
      };
    }
    this.drainedInstance = instance;
    this.drainAttempts += 1;
    return { kind: "drain", attempt: this.drainAttempts };
  }

  /** Drain the combined client over the frozen control core, then wait (fail-fast)
   *  for the link to die — the transport-adapted twin of the local
   *  `drainViaControlCore`'s socket-close wait. Over the ssh bridge there is no local
   *  socket to watch, so a liveness poll (`control.core.hello` until it rejects) IS
   *  the "the daemon exited" signal. Returns `true` if the link died within the
   *  teardown window (the drain took → the reconnect will respawn), `false` if the
   *  daemon kept answering (the drain did not take — the caller adopts/refuses, NEVER
   *  a kill). */
  private async drainAndAwaitClose(
    combined: PadiDaemonClient,
  ): Promise<{ took: boolean; drainRejection: string | null }> {
    // Capture the drain RPC's rejection reason — it does NOT decide completion (the
    // link death below does), but the "did not take" paths surface it so a failed
    // drain is diagnosable (a wedged link vs. an `onDrain` throw inside padi),
    // mirroring the local arm's `drainViaControlCore` (which appends `drainErr` to its
    // timeout error rather than swallowing it — `caught-error-must-not-collapse`).
    let drainRejection: string | null = null;
    void combined.surface.control.core.drain().catch((e) => {
      // The call may resolve OR reject as the link tears down mid-response (padi
      // exited) — its outcome does not decide completion; the link death (below) does.
      drainRejection = String(e);
    });
    const deadline = Date.now() + this.drainCeilingMs;
    // Poll liveness, deciding on the HELLO, never on the trailing sleep: a daemon that
    // exits DURING a sleep must still be caught by the next hello, and the window is
    // only exhausted after a hello that STILL answered — so a real exit is never
    // misread as "did not take".
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { took: false, drainRejection }; // window exhausted → did not take.
      // RACE the liveness probe against the REMAINING window. Over ssh a wedged link
      // can leave `hello()` hanging — neither answering nor rejecting — and a bare
      // `await` on it would defeat the ceiling entirely (the deadline check after it
      // never runs). So bound each probe: a REJECT (link/daemon gone) → the drain took
      // (true); an outstanding probe that OUTLIVES the window → cannot confirm the exit
      // → did-not-take (false), the caller adopts/refuses, NEVER a kill. The probe is
      // pre-caught so a late-settling hello can't surface as an unhandled rejection
      // after the ceiling already won.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const probe = combined.surface.control.core
        .hello()
        .then(() => "answered" as const)
        .catch(() => "dead" as const);
      const ceiling = new Promise<"ceiling">((resolve) => {
        timer = setTimeout(() => resolve("ceiling"), remaining);
      });
      const outcome = await Promise.race([probe, ceiling]);
      clearTimeout(timer);
      // stopped answering → it exited → took.
      if (outcome === "dead") return { took: true, drainRejection };
      // probe outlived the window → not taken.
      if (outcome === "ceiling") return { took: false, drainRejection };
      await sleep(this.drainPollMs); // still answering — poll again until the deadline.
    }
  }

  isDestroyed(): boolean {
    return this.destroyed || this.host.isDestroyed();
  }

  onState(cb: (s: HostSessionState) => void): () => void {
    this.stateListeners.add(cb);
    // snapshot-then-delta, like an inMemoryCell onState — GUARDED like every later
    // transition (a subscriber that throws on the initial snapshot must not escape
    // uncaught any more than one that throws on a `fire()`).
    this.safeEmit(cb, this.derivedState());
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  markConnected(): void {
    // The pump calls this on the first folded frame — forward it so the HostSession
    // flips connecting → connected and disarms its connect watchdog.
    this.host.markConnected();
  }

  destroy(): void {
    this.destroyed = true;
    this.hostUnsub();
    // Faithful to the pre-union `this.identity = null`: drop a bound identity; a
    // standing skew verdict is left as-is (the readouts below already gate on
    // `destroyed`, and derivedState kept the skew frame the same way before).
    if (this.bindState.kind === "bound") this.bindState = { kind: "unbound" };
    this.memoKey = null;
    this.memoScoped = null;
    this.host.destroy();
    // Wake any cursor blocked on the next client so the pump exits.
    this.fire();
  }

  /** DRAIN the bound padi over the FROZEN control core (the "restart" verb): padi
   *  persists + exits, its kaval + PTYs survive, the front's relay ends → the
   *  HostSession reconnects and `frontDaemonOverStdio` re-adopts or respawns. NEVER a
   *  kill-9.
   *
   *  Two guarantees the local arm's `drainViaControlCore` also makes, so the "restart"
   *  verb behaves identically over ssh:
   *
   *    1. **Only a BOUND padi drains.** The user restarts a padi this session actually
   *       adopted — not one we merely REFUSED for a version skew (bindState `skew`) nor
   *       a mid-reconnect gap (bindState `unbound`). Draining a refused padi would
   *       bypass the bind verdict and, for an OLDER binder that refused a NEWER padi,
   *       DOWNGRADE it against the newest-wins monotonicity guarantee. So refuse with an
   *       honest error rather than drain over the raw host client.
   *    2. **Ground truth is the LINK DEATH, not the drain reply.** padi's control-core
   *       `drain` REPLIES before its socket closes, so returning on the reply would
   *       report "restarted" with the old padi still alive. Wait for the exit
   *       (fail-fast) via {@link drainAndAwaitClose} and THROW if it does not exit in
   *       the window, so the restart never reports a success that did not happen. */
  async drainBoundPadi(): Promise<void> {
    // `bound` OR `adoptedStale` are both LIVE adopted daemons (the host client is non-null,
    // the canvas works) — either is drainable (a restart tears it down and the reconnect
    // re-runs convergence). The no-live-client states have no daemon we adopted to drain.
    if (
      this.bindState.kind !== "bound" &&
      this.bindState.kind !== "adoptedStale"
    ) {
      throw new Error(
        `remote padi has no adopted daemon to drain (${this.bindState.kind}: refused / unconverged / link-failed / mid-reconnect)`,
      );
    }
    const combinedP = this.host.currentClient();
    if (combinedP === null) {
      throw new Error(
        "remote padi is not bound — cannot drain (the daemon is unreachable)",
      );
    }
    const combined = (await combinedP) as PadiDaemonClient;
    const { took, drainRejection } = await this.drainAndAwaitClose(combined);
    if (!took) {
      throw new Error(
        `remote padi drain did not complete — it did not exit within ${this.drainCeilingMs}ms (padi did not exit)` +
          (drainRejection ? `; drain call rejected: ${drainRejection}` : ""),
      );
    }
  }

  /** The LIVE padi's identity — present for both a converged `bound` AND an `adoptedStale`
   *  (the resident daemon we rode: canvas works, so the dialog reads the identity that is
   *  actually running); null for every no-live-client state. */
  private liveIdentity(): RemotePadiIdentity | null {
    if (this.destroyed) return null;
    return this.bindState.kind === "bound" ||
      this.bindState.kind === "adoptedStale"
      ? this.bindState.identity
      : null;
  }

  padiStartedAt(): number | null {
    return this.liveIdentity()?.startedAt ?? null;
  }

  padiSurfaceVersion(): string | null {
    return this.liveIdentity()?.surfaceVersion ?? null;
  }

  padiBuildCommit(): string | null {
    return this.liveIdentity()?.commit ?? null;
  }

  /** The STANDING convergence anomaly for `boundPadi.convergence` — so the Padi dialog
   *  shows WHY a bind is degraded (adopted-stale build / contract skew / drain-failure /
   *  link-failure) instead of it being swallowed into server logs. `null` for the healthy
   *  `bound`/`unbound` states (no banner). */
  padiConvergence(): PadiConvergence | null {
    if (this.destroyed) return null;
    switch (this.bindState.kind) {
      case "adoptedStale":
        return {
          state: "adopted-stale",
          runningBuild: this.bindState.runningBuild,
          expectedBuild: this.bindState.expectedBuild,
          detail: this.bindState.detail,
        };
      case "skew":
        return {
          state: "skew-refused",
          runningBuild: null,
          expectedBuild: null,
          detail: this.bindState.error,
        };
      case "unconverged":
        return {
          state: "unconverged",
          runningBuild: null,
          expectedBuild: null,
          detail: this.bindState.error,
        };
      case "linkFailed":
        return {
          state: "link-failed",
          runningBuild: null,
          expectedBuild: null,
          detail: this.bindState.error,
        };
      default:
        return null;
    }
  }

  /** The state the connection cell reads: the HostSession's link phase, overlaid with a
   *  loud degraded frame while a CONTRACT-axis refusal stands (the transport is up but we
   *  refuse to speak an incompatible/undrainable surface). `adoptedStale`/`bound` keep the
   *  transport's "connected" (canvas alive — the reason rides `boundPadi.convergence`);
   *  `linkFailed` already carries the transport's terminal `failed` frame, so both fall
   *  through unchanged. Never a silent "connected but empty". */
  private derivedState(): HostSessionState {
    // A contract SKEW (incompatible surface, binder older) and a contract UNCONVERGED (a
    // newer-contract drain that never took) are the two loud degraded frames where the
    // transport is up but we refuse to serve — overlay the "connected" with an honest
    // disconnected+error. (A build mismatch no longer reaches here: it ADOPTS the resident.)
    if (
      this.bindState.kind === "skew" ||
      this.bindState.kind === "unconverged"
    ) {
      return {
        ...this.hostState,
        connection: "disconnected",
        lastError: this.bindState.error,
        failureCause: "remote",
      };
    }
    return this.hostState;
  }

  private fire(): void {
    const s = this.derivedState();
    // Guard each listener at the funnel: a throwing subscriber must not abort the
    // fan-out and drop this transition for the listeners after it.
    for (const cb of [...this.stateListeners]) this.safeEmit(cb, s);
  }

  /** The single guarded fan-out site — used by both the initial `onState` snapshot
   *  and every `fire()` transition, so neither path can leak a subscriber throw. */
  private safeEmit(
    cb: (s: HostSessionState) => void,
    s: HostSessionState,
  ): void {
    try {
      cb(s);
    } catch (err) {
      log.error({ err }, "remote padi binding state listener threw");
    }
  }
}

export interface EnsureRemotePadiBindingOptions {
  /** The ssh host to bind (an `~/.ssh/config` alias or `user@host`), from the
   *  {@link KOLU_PADI_HOST_ENV} knob. */
  host: string;
  /** The kolu app version to stamp as the remote-spawned PTYs' `TERM_PROGRAM_VERSION`
   *  — the SAME value the LOCAL arm forwards through padi's `--spawn-version`
   *  (`serverVersion`). Passed via `extraArgs` — appended AFTER the `--stdio` that
   *  `getHostSession`/`buildAgentCommand` already adds (we never re-pass `--stdio`); the
   *  `--stdio` front's `reExecAsDetachedDaemon` re-execs argv MINUS `--stdio`, so the
   *  flag rides through to the durable daemon `runPadiDaemon` spawns — without it a
   *  remote terminal reports the remote padi's OWN commit/dev version, not the kolu
   *  app version a local terminal from the same build reports. Omitted → the remote
   *  padi falls back to its own commit (a standalone bring-up). */
  spawnVersion?: string;
}

/**
 * The remote padi front's `extraArgs`, which `getHostSession`/`buildAgentCommand` appends
 * AFTER the `--stdio` it already runs the binary with (host.ts). F2: this must NEVER re-add
 * `--stdio` — a duplicate flag makes the `--stdio` front strip only one and re-exec the daemon
 * STILL in front mode, wedging the boot. Only `--spawn-version` (the kolu app version, so a
 * remote terminal's `TERM_PROGRAM_VERSION` is the app version, not the remote padi's commit)
 * rides through to `runPadiDaemon`.
 */
export function composePadiExtraArgs(
  spawnVersion: string | null | undefined,
): string[] {
  return spawnVersion != null ? ["--spawn-version", spawnVersion] : [];
}

/**
 * Bind a REMOTE padi over ssh and return the reconnect-mirror session `reServeSurface`
 * consumes — the twin of {@link ensurePadiBinding}, but one ssh hop away. Unlike the
 * local arm it does NOT await the first connection: provisioning a closure over ssh
 * (`nix copy` + realise) can take seconds, and the binding is fail-open by
 * construction — the connection cell reports copying/connecting/degraded while it
 * warms, and the reconnect loop retries a transient failure forever. The pump warms
 * it the moment `reServeSurface` pins the session.
 */
export function ensureRemotePadiBinding(
  opts: EnsureRemotePadiBindingOptions,
): BoundPadi {
  const host = opts.host;
  log.info(
    { host },
    `binding a REMOTE padi over ssh (${KOLU_PADI_HOST_ENV} set) — the whole canvas is this host`,
  );
  // The STATIC-config axis, decided ONCE here: parse + validate the baked drv map
  // EAGERLY so a missing/malformed BAKED map crashes boot loudly (index.ts calls this
  // synchronously with no try/catch — fail-fast) instead of degrading the canvas
  // through the deferred resolver's retry-then-terminal path.
  const drvMap = parsePadiDrvMap();
  // `getHostSession`/`buildAgentCommand` ALREADY runs the binary as `<padi> --stdio`
  // (host.ts) — extraArgs are appended AFTER `--stdio`, so we pass ONLY `--spawn-version`,
  // never `--stdio` again. The `--stdio` front re-execs argv minus `--stdio` to bring up
  // the durable daemon (`reExecAsDetachedDaemon`), so `--spawn-version` rides straight
  // through to `runPadiDaemon` — the remote twin of the local arm forwarding `serverVersion`
  // into padi's `--spawn-version`, so a remote terminal's `TERM_PROGRAM_VERSION` is the
  // kolu app version, not the remote padi's own commit.
  const extraArgs = composePadiExtraArgs(opts.spawnVersion);
  const session = getHostSession<PadiDaemonContract>({
    host,
    // `${agentPath}/bin/padi`, run as `padi --stdio` — the durable-daemon front.
    binary: "padi",
    extraArgs,
    resolveDrvPath: makeResolvePadiDrv(host, drvMap),
    onLog: (line) => log.info({ host, line }, "remote padi session"),
  });
  return new RemotePadiSession(session, host);
}
