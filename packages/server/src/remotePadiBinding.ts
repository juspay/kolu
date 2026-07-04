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
import { DaemonContractSkewError } from "@kolu/surface-daemon-supervisor";
import {
  getHostSession,
  type HostSessionState,
  type RemoteMirrorSession,
  ResolveDrvError,
  resolveSystem,
} from "@kolu/surface-nix-host";
import {
  type BoundPadi,
  type BuildDrainFence,
  createBuildDrainFence,
  isBinderNewer,
} from "./padiBinding.ts";
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

/** Build the `resolveDrvPath` thunk `getHostSession` runs at the top of EVERY
 *  spawn: probe the remote arch (`resolveSystem`, an ssh round-trip) and pick the
 *  baked padi `.drv` for it. kaval rides INSIDE padi's closure (`KOLU_KAVAL_BIN` is
 *  baked in padi's wrapper), so this ONE drv provisions both daemons. A bad/absent
 *  map is a TERMINAL config fault (`ResolveDrvError` with `"remote"` → the session
 *  gives up loudly rather than retrying an unwinnable spawn forever); an unreachable
 *  host makes `resolveSystem` reject plainly → the session reads that as `"network"`
 *  and retries until the host is back. */
function makeResolvePadiDrv(host: string): () => Promise<string> {
  return async () => {
    const raw = process.env[PADI_AGENT_DRVS_ENV]?.trim();
    if (!raw || raw === "{}") {
      throw new ResolveDrvError(
        `${PADI_AGENT_DRVS_ENV} is not baked — a remote padi binding (${KOLU_PADI_HOST_ENV}) needs kolu-server run from its Nix wrapper, which bakes the arch-keyed padi drv map. Unset ${KOLU_PADI_HOST_ENV} to bind the local padi.`,
        "remote",
      );
    }
    let map: Record<string, string>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error("not a JSON object");
      map = parsed as Record<string, string>;
    } catch (err) {
      throw new ResolveDrvError(
        `${PADI_AGENT_DRVS_ENV} is not a valid { system → drv } JSON map: ${(err as Error).message}`,
        "remote",
      );
    }
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

export class RemotePadiSession implements BoundPadi {
  private destroyed = false;
  /** The binder's contract version + expected build id + the once-per-boot fence —
   *  the "us" side of the same two-axis convergence the LOCAL arm runs in
   *  `drainSupersededSurvivor`, applied here at the remote bind. */
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

  /** The bound padi's identity off its last successful `hello`, or `null` while
   *  unbound / mid-warm — cleared when the link drops (a respawned padi is a fresh
   *  process). */
  private identity: RemotePadiIdentity | null = null;
  /** Set when the last handshake found a padiSurface version this kolu-server can't
   *  speak — overlays the connection state as a loud, honest degraded/skew frame
   *  (not the transport-level "connected" the HostSession would otherwise report).
   *  Cleared on a fresh spawn (which re-handshakes) or a link drop. */
  private skewError: string | null = null;

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
        this.identity = null;
        this.skewError = null;
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
   * the SAME two-axis convergence the LOCAL arm runs in `drainSupersededSurvivor` —
   * applied here at the remote bind because `hello.buildId` (running) and the baked
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

      // ── Axis 1 — the CONTRACT. On a skew the contract decides; the build id is
      // irrelevant. Mirrors `drainSupersededSurvivor` Axis 1. ──
      if (!isContractVersionCompatible(running, this.binderVersion)) {
        if (!isBinderNewer(this.binderVersion, running)) {
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
        if (await this.drainAndAwaitClose(combined)) {
          // The reconnect brings up the newer closure; the cursor waits for it.
          throw new Error(
            "remote padi drained (newer contract) — reconnecting to the respawned newer build",
          );
        }
        // Drain did not take → cannot adopt an incompatible contract → REFUSE (degraded).
        log.error(
          { host: this.hostName, binderVersion: this.binderVersion, running },
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
      // correctly drains as an older build) — is a MISMATCH we drain once. Mirrors
      // `drainSupersededSurvivor` Axis 2 EXACTLY. ──
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
      if (await this.drainAndAwaitClose(combined)) {
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
    this.skewError = null;
    this.identity = {
      surfaceVersion: hello.surfaceVersion,
      commit: hello.commit || null,
      startedAt: hello.startedAt ?? null,
    };
    this.fire();
    return scopePadiSurface(combined);
  }

  /** REFUSE the survivor: flag the loud degraded/skew frame the connection cell
   *  reads, and REJECT so the pump's cursor keeps waiting (`waitForNextClient`
   *  swallows it — no crash, no spin), never a kill. */
  private refuse(msg: string): never {
    this.skewError = msg;
    this.identity = null;
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
  ): Promise<boolean> {
    void combined.surface.control.core.drain().catch(() => {
      // The call may resolve OR reject as the link tears down mid-response (padi
      // exited) — its outcome does not decide completion; the link death (below) does.
    });
    const deadline = Date.now() + this.drainCeilingMs;
    while (Date.now() < deadline) {
      try {
        await combined.surface.control.core.hello();
      } catch {
        return true; // the daemon stopped answering → it exited → the drain took.
      }
      await sleep(this.drainPollMs);
    }
    return false; // still answering past the window → the drain did not take.
  }

  isDestroyed(): boolean {
    return this.destroyed || this.host.isDestroyed();
  }

  onState(cb: (s: HostSessionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.derivedState()); // snapshot-then-delta, like an inMemoryCell onState.
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
    this.identity = null;
    this.memoKey = null;
    this.memoScoped = null;
    this.host.destroy();
    // Wake any cursor blocked on the next client so the pump exits.
    this.fire();
  }

  /** DRAIN the bound padi over the FROZEN control core (the "restart" verb): padi
   *  persists + exits, its kaval + PTYs survive, the front's relay ends → the
   *  HostSession reconnects and `frontDaemonOverStdio` re-adopts or respawns. The
   *  drain call may resolve OR reject as the ssh link tears down mid-response (the
   *  same teardown race the local `drainViaControlCore` reads off the socket close),
   *  so swallow that rejection — the drain reached padi either way. NEVER a kill-9. */
  async drainBoundPadi(): Promise<void> {
    const combinedP = this.host.currentClient();
    if (combinedP === null) {
      throw new Error(
        "remote padi is not bound — cannot drain (the daemon is unreachable)",
      );
    }
    const combined = (await combinedP) as PadiDaemonClient;
    await combined.surface.control.core.drain().catch(() => {
      // The link tore down mid-response (padi exited) — the expected teardown.
    });
  }

  padiStartedAt(): number | null {
    return this.destroyed ? null : (this.identity?.startedAt ?? null);
  }

  padiSurfaceVersion(): string | null {
    return this.destroyed ? null : (this.identity?.surfaceVersion ?? null);
  }

  padiBuildCommit(): string | null {
    return this.destroyed ? null : (this.identity?.commit ?? null);
  }

  /** The state the connection cell reads: the HostSession's link phase, overlaid
   *  with a loud degraded/skew frame while a version mismatch stands (the transport
   *  is up but we refuse to speak the surface — an honest "reconnecting/degraded",
   *  never a silent "connected but empty"). */
  private derivedState(): HostSessionState {
    if (this.skewError) {
      return {
        ...this.hostState,
        connection: "disconnected",
        lastError: this.skewError,
        failureCause: "remote",
      };
    }
    return this.hostState;
  }

  private fire(): void {
    const s = this.derivedState();
    // Guard each listener at the funnel: a throwing subscriber must not abort the
    // fan-out and drop this transition for the listeners after it.
    for (const cb of [...this.stateListeners]) {
      try {
        cb(s);
      } catch (err) {
        log.error({ err }, "remote padi binding state listener threw");
      }
    }
  }
}

export interface EnsureRemotePadiBindingOptions {
  /** The ssh host to bind (an `~/.ssh/config` alias or `user@host`), from the
   *  {@link KOLU_PADI_HOST_ENV} knob. */
  host: string;
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
  const session = getHostSession<PadiDaemonContract>({
    host,
    // `${agentPath}/bin/padi`, run as `padi --stdio` — the durable-daemon front.
    binary: "padi",
    extraArgs: ["--stdio"],
    resolveDrvPath: makeResolvePadiDrv(host),
    onLog: (line) => log.info({ host, line }, "remote padi session"),
    reconnectDelayMs: opts.reconnectDelayMs,
  });
  return new RemotePadiSession(session, host);
}
