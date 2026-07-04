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
import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  type BuildDrainFence,
  contractIsNewer,
  createBuildDrainFence,
  DaemonContractSkewError,
} from "@kolu/surface-daemon-supervisor";
import {
  getHostSession,
  type HostSessionState,
  type RemoteMirrorSession,
  ResolveDrvError,
  resolveSystem,
} from "@kolu/surface-nix-host";
import type { BoundPadi } from "./padiBinding.ts";
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

/** The padi's bind outcome as ONE named state — unbound, adopted (with the honest
 *  identity off its `hello`), or refused for a version skew (with the loud error).
 *  A single discriminated field makes the illegal "both an identity AND a skew"
 *  combination unrepresentable, replacing the old parallel-nullable `identity` +
 *  `skewError` pair and its scattered "at most one is ever set" invariant. */
type BindState =
  | { kind: "unbound" }
  | { kind: "bound"; identity: RemotePadiIdentity }
  | { kind: "skew"; error: string };

/** The convergence deps — the binder's side of the two-axis drain decision, and the
 *  once-per-boot fence. All default to the production values; injected in tests to
 *  drive the drain path without two real builds. */
export interface RemotePadiSessionDeps {
  /** The binder's `padiSurface` version (the contract axis's "us" side). */
  binderVersion?: string;
  /** The binder's expected padi build id — the baked, ARCH-INDEPENDENT `PADI_BUILD_ID`
   *  source hash (so a binder built for arch A and the remote padi built for arch B
   *  agree iff their source matches). `""` for an off-nix binder that cannot judge
   *  builds. Default {@link currentPadiBuildId}. */
  binderBuildId?: string;
  /** The once-per-binder-boot build-mismatch drain fence. MUST be shared across the
   *  session's reconnects (created once per binder boot) — default a fresh fence. */
  buildDrainFence?: BuildDrainFence;
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
 *      combined client's `control.core.hello()` (identity + versions) and refuses a
 *      padi it cannot speak to (`isContractVersionCompatible`), exactly as
 *      `connectPadi` does over a local socket. A refusal REJECTS the mirrored client
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
  /** The binder's contract version + expected build id + the once-per-boot fence —
   *  the "us" side of the same two-axis convergence the LOCAL arm now declares as
   *  `PADI_CONVERGENCE_POLICY` and runs through the shared `converge()`/`decide()` kit,
   *  hand-mirrored here at the remote bind (the future both-arms-unification ledger
   *  item). */
  private readonly binderVersion: string;
  private readonly binderBuildId: string;
  private readonly buildDrainFence: BuildDrainFence;
  private readonly drainCeilingMs: number;
  private readonly drainPollMs: number;
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
    this.buildDrainFence = deps.buildDrainFence ?? createBuildDrainFence();
    this.drainCeilingMs =
      deps.drainTeardownCeilingMs ?? REMOTE_DRAIN_TEARDOWN_CEILING_MS;
    this.drainPollMs = deps.drainPollMs ?? REMOTE_DRAIN_POLL_MS;
    // HostSession.onState is snapshot-then-delta: the first fire below runs
    // synchronously and seeds `hostState`, then every transition tracks it.
    this.hostUnsub = host.onState((s) => {
      this.hostState = s;
      // A dropped link invalidates identity + any skew verdict (the next spawn may
      // differ) and the memoized client (its promise is dead). Transient warming
      // (copying/connecting) leaves a just-read identity in place, matching the
      // local arm's "clear on degraded/dead only".
      if (s.connection === "disconnected" || s.connection === "failed") {
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
    }
    return this.memoScoped;
  }

  /**
   * The control-core `hello` handshake over a fresh spawn's combined client, plus
   * the SAME two-axis convergence the LOCAL arm declares as `PADI_CONVERGENCE_POLICY`
   * (run through the shared `decide()`/`converge()` kit) — hand-mirrored here at the
   * remote bind because `hello.buildId` (running) and the baked
   * arch-independent `PADI_BUILD_ID` (this binder) put BOTH sides of the #1670
   * comparison in hand over the ssh dial:
   *
   *   Axis 1 — CONTRACT (`padiSurface` version): skew + binder NEWER → DRAIN
   *   (newest-wins); skew + binder OLDER → REFUSE (degraded, never drain).
   *   Axis 2 — BUILD (same contract; #1670): a different OR absent `buildId` is a
   *   MISMATCH → DRAIN ONCE per binder boot (fenced); else ADOPT.
   *
   * The transport-adapted difference from the local arm: a DRAIN here tears down the
   * SAME link this handshake rode, so on a successful drain we REJECT (the cursor
   * waits) and the HostSession's own reconnect respawns this binder's closure (the
   * exact drain→respawn the pu-box run proves) — where the local arm's separate
   * `adoptOrSpawnOrRefuse` spawns. A drain that does NOT take is NEVER a kill: on the
   * build axis we ADOPT the compatible old-build survivor (degraded, fence spent); on
   * the contract axis we REFUSE (can't speak an incompatible surface). An ADOPT hands
   * back the padi-scoped client the re-serve mirrors.
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

      // ── Axis 1 — the CONTRACT. On a skew the contract decides; the build id is
      // irrelevant. Mirrors the local policy `onContractSkew: drain-newer-else-refuse`
      // (`PADI_CONVERGENCE_POLICY` → the kit's `decide()`). The newest-wins
      // comparator is the kit's exported `contractIsNewer` (contract versions are
      // ORDERED — the kit's Pin 2; only build ids are match-only), the same leaf the
      // local arm's `decide()` uses. Reusing the leaf, NOT the decision FLOW: the
      // two-axis cascade below stays hand-mirrored (the future both-arms-unification
      // ledger item). ──
      if (!isContractVersionCompatible(running, this.binderVersion)) {
        if (!contractIsNewer(this.binderVersion, running)) {
          // Skew, binder OLDER/behind → REFUSE, never drain (#1313 + monotonicity).
          const msg = `padi contract skew: remote padi serves padiSurface ${running}, kolu-server needs ${this.binderVersion} — this binder is OLDER/behind, refusing`;
          log.warn(
            { host: this.hostName, binderVersion: this.binderVersion, running },
            "remote padi survivor is a padiSurface skew and this binder is OLDER/behind — " +
              "REFUSING (never draining a running padi; it is left standing + degraded). " +
              "Upgrade kolu-server to converge.",
          );
          return this.refuse(msg);
        }
        // Skew, binder NEWER → DRAIN (no fence; monotone version ordering is the guarantee).
        log.info(
          { host: this.hostName, binderVersion: this.binderVersion, running },
          "remote padi survivor is a padiSurface skew and this binder is NEWER — draining it " +
            "(persist + exit; its kaval + PTYs survive) so the reconnect respawns this binder's " +
            "own newer closure (newest-wins convergence)",
        );
        const contractDrain = await this.drainAndAwaitClose(combined);
        if (contractDrain.took) {
          // The reconnect brings up the newer closure; the cursor waits for it.
          throw new Error(
            "remote padi drained (newer contract) — reconnecting to the respawned newer build",
          );
        }
        // Drain did not take → cannot adopt an incompatible contract → REFUSE (degraded).
        log.error(
          {
            host: this.hostName,
            binderVersion: this.binderVersion,
            running,
            drainRejection: contractDrain.drainRejection,
          },
          "newer-binder drain of a skewed remote padi FAILED (it did not exit in the teardown " +
            "window) — NOT killing it; refusing (degraded), the reconnect loop retries, so no " +
            "livelock, no kill",
        );
        return this.refuse(
          `padi contract skew: remote padi serves padiSurface ${running}, kolu-server needs ${this.binderVersion} — newer-binder drain did not take, refusing`,
        );
      }

      // ── Axis 2 — the BUILD (same contract; #1670). ADOPT (no drain) only when we
      // cannot/need not converge: off-nix binder, provably-equal build, or the fence
      // already fired. Everything else — a different OR ABSENT id (`?? ""` folds absent
      // → "", which never equals a nix binder's non-empty id, so a pre-field survivor
      // correctly drains as an older build) — is a MISMATCH we drain once. Mirrors the
      // local policy `onBuildMismatch: drain-and-replace` (`PADI_CONVERGENCE_POLICY` →
      // the kit's `decide()`). ──
      const runningBuild = hello.buildId ?? "";
      if (
        this.binderBuildId === "" || // off-nix binder: cannot judge builds → never drains
        runningBuild === this.binderBuildId || // provably the same build → adopt
        this.buildDrainFence.hasFired() // already drained once this binder boot → adopt
      ) {
        return this.adopt(combined, hello);
      }

      // Commit the ONE build-mismatch drain this binder will ever do — marked BEFORE
      // the await, so even a drain failure spends the fence (degraded-loudly, never a
      // retry that could livelock two binders). The breadcrumb mirrors the local arm
      // verbatim (the adoption VM arm greps `padi build change on boot: running=<X>
      // expected=<Y>`).
      this.buildDrainFence.markFired();
      log.info(
        {
          host: this.hostName,
          binderBuildId: this.binderBuildId,
          runningBuild,
          running,
        },
        `padi build change on boot: running=${runningBuild} expected=${this.binderBuildId}` +
          " — draining the survivor once (persist + exit; its kaval + PTYs survive) and " +
          "respawning this binder's own build (drain-on-build-mismatch, #1670; store hashes " +
          "don't order, so this fires at most once per binder boot)",
      );
      const buildDrain = await this.drainAndAwaitClose(combined);
      if (buildDrain.took) {
        throw new Error(
          "remote padi drained (build mismatch) — reconnecting to the respawned build",
        );
      }
      // Drain did not take → ADOPT the compatible old-build survivor, degraded +
      // logged, fence spent (no reconnect re-drains). Mirrors the local arm's
      // build-drain-failure arm (#1034: drain-only, degraded-loudly, no livelock).
      log.error(
        {
          host: this.hostName,
          binderBuildId: this.binderBuildId,
          runningBuild,
          drainRejection: buildDrain.drainRejection,
        },
        "build-mismatch drain of the remote padi FAILED (it did not exit in the teardown " +
          "window) — NOT killing it; ADOPTING the compatible (old-build) survivor, degraded " +
          "to the old build and logged loudly, and the fence stays spent so no reconnect re-drains",
      );
      return this.adopt(combined, hello);
    });
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

  /** REFUSE the survivor: flag the loud degraded/skew frame the connection cell
   *  reads, and REJECT so the pump's cursor keeps waiting (`waitForNextClient`
   *  swallows it — no crash, no spin), never a kill. */
  private refuse(msg: string): never {
    this.bindState = { kind: "skew", error: msg };
    this.fire();
    throw new DaemonContractSkewError(msg);
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
    if (this.bindState.kind !== "bound") {
      throw new Error(
        `remote padi is not bound — cannot drain (${this.bindState.kind}: skew/refused or mid-reconnect)`,
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

  padiStartedAt(): number | null {
    if (this.destroyed || this.bindState.kind !== "bound") return null;
    return this.bindState.identity.startedAt;
  }

  padiSurfaceVersion(): string | null {
    if (this.destroyed || this.bindState.kind !== "bound") return null;
    return this.bindState.identity.surfaceVersion;
  }

  padiBuildCommit(): string | null {
    if (this.destroyed || this.bindState.kind !== "bound") return null;
    return this.bindState.identity.commit;
  }

  /** The state the connection cell reads: the HostSession's link phase, overlaid
   *  with a loud degraded/skew frame while a version mismatch stands (the transport
   *  is up but we refuse to speak the surface — an honest "reconnecting/degraded",
   *  never a silent "connected but empty"). */
  private derivedState(): HostSessionState {
    if (this.bindState.kind === "skew") {
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
   *  (`serverVersion`). Passed to the remote `padi --stdio` in `extraArgs`; the
   *  `--stdio` front's `reExecAsDetachedDaemon` re-execs argv MINUS `--stdio`, so the
   *  flag rides through to the durable daemon `runPadiDaemon` spawns — without it a
   *  remote terminal reports the remote padi's OWN commit/dev version, not the kolu
   *  app version a local terminal from the same build reports. Omitted → the remote
   *  padi falls back to its own commit (a standalone bring-up). */
  spawnVersion?: string;
  /** Reconnect backoff between an ssh drop and the next front attempt (test hook;
   *  default is `getHostSession`'s 2s). */
  reconnectDelayMs?: number;
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
  // `padi --stdio [--spawn-version <ver>]`. The `--stdio` front re-execs argv minus
  // `--stdio` to bring up the durable daemon (`reExecAsDetachedDaemon`), so the
  // `--spawn-version` flag rides straight through to `runPadiDaemon` — the remote twin
  // of the local arm forwarding `serverVersion` into padi's `--spawn-version`, so a
  // remote terminal's `TERM_PROGRAM_VERSION` is the kolu app version, not the remote
  // padi's own commit.
  const extraArgs =
    opts.spawnVersion != null
      ? ["--stdio", "--spawn-version", opts.spawnVersion]
      : ["--stdio"];
  const session = getHostSession<PadiDaemonContract>({
    host,
    // `${agentPath}/bin/padi`, run as `padi --stdio` — the durable-daemon front.
    binary: "padi",
    extraArgs,
    resolveDrvPath: makeResolvePadiDrv(host, drvMap),
    onLog: (line) => log.info({ host, line }, "remote padi session"),
    reconnectDelayMs: opts.reconnectDelayMs,
  });
  return new RemotePadiSession(session, host);
}
