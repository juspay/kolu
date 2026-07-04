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

import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
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
import type { BoundPadi } from "./padiBinding.ts";
import { log } from "./log.ts";

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
export class RemotePadiSession implements BoundPadi {
  private destroyed = false;
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
  ) {
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

  /** Run the control-core `hello` over a fresh spawn's combined client: read
   *  identity, refuse an incompatible padiSurface loudly, else hand back the
   *  padi-scoped client the re-serve mirrors. A refusal REJECTS (the cursor waits;
   *  the connection cell shows skew via `fire`). */
  private handshakeAndScope(
    combinedP: Promise<unknown>,
  ): Promise<PadiSurfaceClient> {
    return combinedP.then(async (raw) => {
      const combined = raw as PadiDaemonClient;
      const hello = await combined.surface.control.core.hello();
      if (
        !isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION)
      ) {
        const msg = `padi contract skew: remote padi serves padiSurface ${hello.surfaceVersion}, kolu-server needs ${PADI_SURFACE_VERSION}`;
        this.skewError = msg;
        this.identity = null;
        this.fire();
        log.error(
          {
            host: this.hostName,
            remoteVersion: hello.surfaceVersion,
            need: PADI_SURFACE_VERSION,
          },
          "remote padi contract skew — refusing to mirror (upgrade kolu-server or the remote padi; the daemon is left standing, never killed)",
        );
        throw new DaemonContractSkewError(msg);
      }
      this.skewError = null;
      this.identity = {
        surfaceVersion: hello.surfaceVersion,
        commit: hello.commit || null,
        startedAt: hello.startedAt ?? null,
      };
      this.fire();
      return scopePadiSurface(combined);
    });
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
