/**
 * The endpoint state machine — the supervisor's view of one daemon.
 *
 * An endpoint owns the relationship between a supervising process (kolu-server;
 * the odu CLI) and one surface daemon it spawns and watches: it takes the
 * daemon from nothing to a live, handshaken connection, and reports — on every
 * transition — an honest `{ state, identity, startedAt }` the supervisor's
 * surface projects so the UI never lies about whether the daemon is there.
 *
 *   connecting → connected            (spawned, socket up, handshake passed)
 *   connecting → dead                 (couldn't recycle / spawn / connect)
 *   connected  → degraded             (the daemon died mid-session)
 *
 * **Boot policy is always-recycle** (B2, "the door"): on `ensure()` a live
 * survivor is *killed*, not adopted, then a fresh daemon is spawned — so no
 * survival hazard can open (no orphan, no skew older than one boot). Every boot
 * therefore exercises kill → `waitForPidGone` → spawn → connect, the exact race
 * #1034 lost, but with zero sessions at stake. Adoption and the supervised
 * restart that *preserve* a session are B3; this endpoint only requires the
 * composed `restart` type, invoking its recycle path.
 *
 * The endpoint is **spine**: generic over the client `C` and the identity `I`,
 * it interprets neither. The contract handshake, the surface shape, and what
 * `identity` means all live in the injected `connect` (the program's soul). The
 * endpoint only orchestrates: gate read, kill, wait, spawn, connect, and the
 * transition reports.
 */

import { gatePid, isHolderLive, type Logger } from "@kolu/surface-daemon";
import { dialSocket } from "./dialSocket.ts";
import type { DaemonDriver } from "./driver.ts";
import { ENDPOINT_STATES, type EndpointState } from "./endpointStates.ts";
import { waitForPidGone } from "./waitForPidGone.ts";

// `ENDPOINT_STATES` / `EndpointState` are the single source of truth for the
// reported state set; they live in the zero-dependency `endpointStates.ts` leaf
// so a browser-shared consumer (kolu's `DaemonStatusSchema`) can derive its enum
// from them without pulling this Node-only module's transport/gate graph. The
// endpoint re-exports them so existing supervisor consumers keep their import.
export { ENDPOINT_STATES, type EndpointState };

export interface EndpointStatus<I> {
  state: EndpointState;
  /** Present once `connected`: the daemon's self-declared identity. */
  identity?: I;
  /** Present once `connected`: the daemon's boot time (ms epoch), for uptime. */
  startedAt?: number;
}

/** A live, handshaken connection to a daemon. The injected `connect` builds it;
 *  the endpoint holds it and tears it down. */
export interface DaemonConnection<C, I> {
  client: C;
  identity: I;
  startedAt: number;
  /** Drop the transport. */
  dispose(): void;
  /** Subscribe to the transport dropping (the daemon exited / the socket
   *  closed). Fires at most once. The endpoint uses it to flip to `degraded`. */
  onClose(cb: () => void): void;
}

export interface EndpointSpec<C, I> {
  /** Which host this endpoint is for. The status is reported per-host so the
   *  shapes stay host-count-agnostic (one local host today; ssh hosts at R-2). */
  hostId: string;
  /** The daemon's single-instance gate path — the same path the daemon's own
   *  `daemonMain` derives, so the supervisor reads the true current holder. */
  gatePath: string;
  /** The unix socket the daemon serves and we dial. */
  socketPath: string;
  /** Spawns the daemon so it outlives us (the survivable-spawn driver). */
  driver: DaemonDriver;
  /** Dial `socketPath`, run the contract-version handshake, and return the live
   *  connection. Rejects on a skew (an incompatible daemon) or a transport
   *  failure — the endpoint treats either as a failed boot (`dead`). */
  connect(): Promise<DaemonConnection<C, I>>;
  log: Logger;
  /** Called on every state transition — the supervisor publishes it. */
  onStatus(hostId: string, status: EndpointStatus<I>): void;
  /** Ceiling for the freshly-spawned daemon's socket to start accepting.
   *  Default 30_000ms. */
  socketReadyMs?: number;
  /** Socket-readiness poll spacing. Default 50ms. */
  socketPollMs?: number;
}

export interface Endpoint<C, I> {
  /** Take the daemon to a live connection under the always-recycle boot policy.
   *  Throws (after reporting `dead`) if it cannot. */
  ensure(): Promise<void>;
  /** The live connection, or `undefined` before `ensure()` or after the daemon
   *  died (`degraded`). */
  current(): DaemonConnection<C, I> | undefined;
  /** Run `body` (a session-preserving restart's inner sequence) with the status
   *  **held at `restarting`** — the emit-guard. While held, the transient
   *  transitions the recycle would otherwise surface (the old connection's
   *  `degraded` close, the fresh daemon's `connecting`) are reported as
   *  `restarting`, so an observer sees one honest "restarting" rather than a
   *  degraded→connecting→connected flicker; only the terminal `connected` /
   *  `dead` pass through to end the hold. Used by `serializeRestart`. */
  holdRestarting(body: () => Promise<void>): Promise<void>;
}

/** Poll until a connection to `socketPath` is accepted, or the ceiling passes.
 *  Resolves `true` if the socket came up, `false` on timeout. Each probe dials
 *  a bare socket through `dialSocket` (the one place that owns the connect/error
 *  race) and immediately closes it — the endpoint's real (handshaken) connection
 *  is made once by `spec.connect()` after this resolves. */
function waitForSocket(
  socketPath: string,
  ceilingMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + ceilingMs;
  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      dialSocket(socketPath).then(
        (sock) => {
          sock.destroy();
          resolve(true);
        },
        () => {
          if (Date.now() >= deadline) resolve(false);
          else setTimeout(attempt, pollMs);
        },
      );
    };
    attempt();
  });
}

/** One-shot probe: does `socketPath` accept a connection RIGHT NOW? Dials once
 *  (no polling) and immediately closes — the recycle path uses it to prove a
 *  live gate-pid is actually the daemon (its socket answers) before SIGTERMing
 *  it, so a stale gate over a reused pid can't make us kill a stranger. */
function socketAccepting(socketPath: string): Promise<boolean> {
  return dialSocket(socketPath).then(
    (sock) => {
      sock.destroy();
      return true;
    },
    () => false,
  );
}

export function createEndpoint<C, I>(spec: EndpointSpec<C, I>): Endpoint<C, I> {
  const socketReadyMs = spec.socketReadyMs ?? 30_000;
  const socketPollMs = spec.socketPollMs ?? 50;
  let conn: DaemonConnection<C, I> | undefined;

  // The emit-guard flag: true only while `holdRestarting` is running a
  // supervised restart's inner sequence. See `emit` for what it coerces.
  let restartHold = false;

  // The last state actually published (post-coercion). `holdRestarting` reads it
  // to detect a restart that errored out BEFORE any terminal `connected`/`dead`
  // transition — leaving the surface pinned at `restarting` — and recover it.
  let lastReported: EndpointState | undefined;

  const emit = (
    state: EndpointState,
    identity?: I,
    startedAt?: number,
  ): void => {
    // While a restart is held, the recycle's transient transitions — the old
    // connection closing (`degraded`) and the fresh daemon coming up
    // (`connecting`) — are both part of one "restarting", not separate states a
    // consumer should render. Coerce them; let the terminal `connected`/`dead`
    // (and the explicit `restarting` from `holdRestarting`) report honestly.
    const reported: EndpointState =
      restartHold && (state === "connecting" || state === "degraded")
        ? "restarting"
        : state;
    lastReported = reported;
    spec.onStatus(spec.hostId, { state: reported, identity, startedAt });
  };

  // The gate-holder check shared by every boot policy: return the live holder
  // whose socket is *accepting* (a real daemon — the adopt-or-kill candidate),
  // or undefined. The gate is PID-ONLY: a hard kill (SIGKILL / power loss)
  // leaves the pidfile behind and the OS can later reuse that pid for an
  // UNRELATED process, so a live pid whose socket is dead/absent is a stale gate
  // over a possibly-reused pid — log it and leave that pid alone (never SIGTERM
  // a stranger), letting the freshly-spawned daemon's own `acquirePidGate` reap
  // the stale gate.
  const liveServingHolder = async (): Promise<number | undefined> => {
    const holder = gatePid(spec.gatePath);
    if (holder === undefined || !isHolderLive(holder)) return undefined;
    if (await socketAccepting(spec.socketPath)) return holder;
    spec.log.warn(
      { hostId: spec.hostId, pid: holder, socketPath: spec.socketPath },
      "gate names a live pid but its socket is dead — treating gate as " +
        "stale (not killing the pid: it may be an unrelated reused pid)",
    );
    return undefined;
  };

  // SIGTERM a proven-live gate holder and wait for it to actually exit. Reports
  // `dead` and throws if it does not exit within the recycle ceiling —
  // respawning over a still-live holder would just yield to it (single
  // instance), a silent no-op recycle, so fail loudly instead.
  const killLiveHolder = async (holder: number): Promise<void> => {
    spec.log.info(
      { hostId: spec.hostId, pid: holder },
      "recycling live daemon (boot policy = always recycle)",
    );
    try {
      process.kill(holder, "SIGTERM");
    } catch {
      // Raced its own exit between the liveness probe and here — fine, the
      // wait below confirms it's gone.
    }
    const gone = await waitForPidGone(holder);
    if (!gone) {
      // Respawning now would just make the new daemon yield to the still-live
      // gate holder (single instance) — a silent no-op recycle. Fail loudly.
      emit("dead");
      throw new Error(
        `daemon pid ${holder} did not exit within the recycle ceiling`,
      );
    }
  };

  // Spawn a fresh daemon, wait for its socket, run the injected handshake, and
  // hold the connection (wiring its mid-session close → `degraded`). Reports
  // `dead` before throwing on any failure (launch, socket-never-up, or a failed
  // handshake), so the UI never sticks at `connecting`.
  const spawnConnectHold = async (): Promise<void> => {
    try {
      await spec.driver.spawn();
    } catch (err) {
      // The launch itself failed (ENOENT/EACCES on the binary, a systemd-run
      // that couldn't fork). The endpoint contract is "failures report `dead`
      // before they throw" — the UI relies on it to leave the indefinite
      // `connecting` state — so flip to `dead` before rethrowing.
      emit("dead");
      throw err;
    }

    const up = await waitForSocket(
      spec.socketPath,
      socketReadyMs,
      socketPollMs,
    );
    if (!up) {
      emit("dead");
      throw new Error(
        `daemon socket ${spec.socketPath} never came up within ${socketReadyMs}ms`,
      );
    }

    let next: DaemonConnection<C, I>;
    try {
      next = await spec.connect();
    } catch (err) {
      // A fresh spawn shouldn't skew (it's the current build), so this is a
      // genuine boot failure — never an import-time throw, just an honest
      // `dead`.
      emit("dead");
      throw err;
    }

    conn = next;
    next.onClose(() => {
      // Only the CURRENT connection's close demotes us — a stale close from a
      // disposed predecessor must not stomp a fresh `connected`.
      if (conn === next) {
        conn = undefined;
        spec.log.warn(
          { hostId: spec.hostId },
          "daemon connection closed mid-session — degraded",
        );
        emit("degraded");
      }
    });
    emit("connected", next.identity, next.startedAt);
  };

  return {
    current: () => conn,

    async holdRestarting(body: () => Promise<void>): Promise<void> {
      // Emit `restarting` up front so the status flips the instant the restart
      // begins (before the capture/drain the caller runs inside `body`), then
      // hold it across the recycle. Cleared in `finally` so a failed restart's
      // `dead` (emitted by the inner recycle, never coerced) is the last word.
      restartHold = true;
      emit("restarting");
      try {
        await body();
      } catch (err) {
        // The recycle (`ensure()`) reports its own terminal `dead`/`connected`
        // before it throws. But a step that runs BEFORE the recycle — `capture`
        // or `drain` — can reject with the surface still pinned at `restarting`,
        // even though the daemon never moved (those steps don't touch the
        // connection). Recover the honest current state so the rail/buttons
        // don't stick in an in-flight state forever: a live connection means the
        // old daemon is still `connected`; no connection means it's `dead`.
        // (Skip if the recycle already emitted a terminal state — `lastReported`
        // is no longer `restarting` — so we never stomp a fresh `connected`/`dead`.)
        if (lastReported === "restarting") {
          // restartHold is still true here, but `connected`/`dead` are never
          // coerced by `emit`, so the recovery reports honestly.
          if (conn) emit("connected", conn.identity, conn.startedAt);
          else emit("dead");
        }
        throw err;
      } finally {
        restartHold = false;
      }
    },

    async ensure(): Promise<void> {
      emit("connecting");
      // ALWAYS RECYCLE (B2, "the door"): a live serving survivor is killed,
      // never adopted, so no survival hazard can open (no orphan, no skew older
      // than one boot). `liveServingHolder` proves a holder is really the daemon
      // before we SIGTERM it; a stale gate over a reused pid is left alone.
      // (Adoption that *preserves* a session is B3's `adoptOrEnsure` — it reuses
      // these same helpers but connects to the survivor instead of killing it.)
      const holder = await liveServingHolder();
      if (holder !== undefined) await killLiveHolder(holder);
      await spawnConnectHold();
    },
  };
}
