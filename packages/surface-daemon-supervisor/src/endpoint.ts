/**
 * The endpoint state machine — the supervisor's view of one daemon.
 *
 * An endpoint owns the relationship between a supervising process (kolu-server;
 * the odu CLI) and one surface daemon it spawns and watches: it takes the
 * daemon from nothing to a live, handshaken connection, and reports — on every
 * transition — an honest `{ state, identity, startedAt }` the supervisor's
 * surface projects so the UI never lies about whether the daemon is there.
 *
 *   connecting → connected            (spawned/adopted, socket up, handshake passed)
 *   connecting → dead                 (couldn't recycle / spawn / connect)
 *   connected  → restarting           (a supervised restart is in flight)
 *   connected  → degraded             (the daemon died mid-session)
 *
 * **Two boot policies, by method.** `ensure()` is *always-recycle* (B2, "the
 * door"): a live survivor is killed, then a fresh daemon is spawned — the recycle
 * the supervised `restart()` composes around. `adoptOrEnsure()` is B3's survival
 * boot: a live, *compatible* survivor is **adopted** (connected without killing,
 * so its PTYs persist across a server-only redeploy); only an absent, dead, or
 * skewed survivor is recycled. Every boot still exercises the same kill →
 * `waitForPidGone` → spawn → connect race when it does recycle.
 *
 * **Restart serialization.** `serializeRestart()` flips the endpoint to
 * `restarting` (when a connection is held) and coalesces concurrent restart
 * triggers onto the one in flight — so a double-click, a palette command, and a
 * forced skew restart racing at once produce a single recycle, and every caller
 * observes `restarting` rather than a torn sequence.
 *
 * The endpoint is **spine**: generic over the client `C` and the identity `I`,
 * it interprets neither. The contract handshake, the surface shape, and what
 * `identity` means all live in the injected `connect` (the program's soul). The
 * endpoint only orchestrates: gate read, adopt-or-kill, wait, spawn, connect, and
 * the transition reports.
 */

import { gatePid, isHolderLive, type Logger } from "@kolu/surface-daemon";
import { dialSocket } from "./dialSocket.ts";
import type { DaemonDriver } from "./driver.ts";
import { type EndpointState, ENDPOINT_STATES } from "./endpointStates.ts";
import { waitForPidGone } from "./waitForPidGone.ts";

// `ENDPOINT_STATES` / `EndpointState` are the single source of truth for the
// reported state set; they live in the zero-dependency `endpointStates.ts` leaf
// so a browser-shared consumer (kolu's `DaemonStatusSchema`) can derive its enum
// from them without pulling this Node-only module's transport/gate graph. The
// endpoint re-exports them so existing supervisor consumers keep their import.
export { type EndpointState, ENDPOINT_STATES };

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
   *  failure — the endpoint treats either as a failed boot (`dead`) when
   *  recycling, or as "can't adopt, recycle instead" when adopting. */
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
  /** Take the daemon to a live connection under the **always-recycle** policy
   *  (kill any live holder, spawn fresh). The recycle the supervised `restart()`
   *  composes around. Throws (after reporting `dead`) if it cannot. */
  ensure(): Promise<void>;
  /** Take the daemon to a live connection under B3's **survival** policy: adopt a
   *  live, compatible survivor (connect without killing, so its PTYs persist
   *  across a server-only redeploy); recycle only an absent, dead, or skewed
   *  survivor. Throws (after reporting `dead`) if it cannot. */
  adoptOrEnsure(): Promise<void>;
  /** Run `run` as a supervised restart: flip to `restarting` (when a connection
   *  is held) and coalesce concurrent triggers onto the one in flight — a second
   *  caller awaits the first and returns without starting its own recycle. */
  serializeRestart(run: () => Promise<void>): Promise<void>;
  /** The live connection, or `undefined` before a boot or after the daemon died
   *  (`degraded`). */
  current(): DaemonConnection<C, I> | undefined;
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
 *  (no polling) and immediately closes — both boot paths use it to prove a live
 *  gate-pid is actually the daemon (its socket answers) before SIGTERMing or
 *  adopting it, so a stale gate over a reused pid can't make us touch a stranger. */
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
  let restartInFlight: Promise<void> | undefined;

  const emit = (state: EndpointState, identity?: I, startedAt?: number): void =>
    spec.onStatus(spec.hostId, { state, identity, startedAt });

  /** Hold `next` as the current connection: wire its mid-session close to a
   *  `degraded` flip (guarding against a stale predecessor's close stomping a
   *  fresh `connected`) and report `connected`. */
  const hold = (next: DaemonConnection<C, I>): void => {
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

  /** SIGTERM a proven-live gate holder and wait for it to actually exit. Reports
   *  `dead` and throws if it does not exit within the recycle ceiling —
   *  respawning over a still-live holder would just yield to it (single instance),
   *  a silent no-op recycle, so fail loudly instead. */
  const killLiveHolder = async (holder: number): Promise<void> => {
    spec.log.info(
      { hostId: spec.hostId, pid: holder },
      "recycling live daemon (kill before spawning fresh)",
    );
    try {
      process.kill(holder, "SIGTERM");
    } catch {
      // Raced its own exit between the liveness probe and here — fine, the wait
      // below confirms it's gone.
    }
    const gone = await waitForPidGone(holder);
    if (!gone) {
      emit("dead");
      throw new Error(
        `daemon pid ${holder} did not exit within the recycle ceiling`,
      );
    }
  };

  /** The gate-holder check shared by both boot policies: returns the live holder
   *  whose socket is *accepting* (a real daemon, adopt-or-kill candidate), or
   *  undefined. Logs and ignores a live pid with a dead socket (a stale gate over
   *  a possibly-reused pid — leave that pid alone). */
  const liveServingHolder = async (): Promise<number | undefined> => {
    const holder = gatePid(spec.gatePath);
    if (holder === undefined || !isHolderLive(holder)) return undefined;
    if (await socketAccepting(spec.socketPath)) return holder;
    spec.log.warn(
      { hostId: spec.hostId, pid: holder, socketPath: spec.socketPath },
      "gate names a live pid but its socket is dead — treating gate as stale " +
        "(not killing the pid: it may be an unrelated reused pid)",
    );
    return undefined;
  };

  /** Spawn a fresh daemon, wait for its socket, handshake, and hold it. Reports
   *  `dead` before throwing on any failure (launch, socket-never-up, or a failed
   *  handshake), so the UI never sticks at `connecting`. */
  const spawnConnectHold = async (): Promise<void> => {
    try {
      await spec.driver.spawn();
    } catch (err) {
      // The launch itself failed (ENOENT/EACCES on the binary, a systemd-run
      // that couldn't fork). Flip to `dead` before rethrowing — the UI relies on
      // it to leave the indefinite `connecting` state.
      emit("dead");
      throw err;
    }

    const up = await waitForSocket(spec.socketPath, socketReadyMs, socketPollMs);
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
      // genuine boot failure — never an import-time throw, just an honest `dead`.
      emit("dead");
      throw err;
    }
    hold(next);
  };

  return {
    current: () => conn,

    async ensure(): Promise<void> {
      emit("connecting");
      // ALWAYS RECYCLE: a live serving survivor is killed, never adopted — the
      // recycle `restart()` composes around. The gate is PID-ONLY, so we kill
      // only a holder whose socket actually answers (`liveServingHolder`), never
      // a stale gate over a reused pid.
      const holder = await liveServingHolder();
      if (holder !== undefined) await killLiveHolder(holder);
      await spawnConnectHold();
    },

    async adoptOrEnsure(): Promise<void> {
      emit("connecting");
      // SURVIVAL BOOT (B3): a live serving survivor is ADOPTED — connected
      // without killing, so a server-only redeploy keeps the daemon and its PTYs.
      // Only an absent/dead survivor, or one whose handshake fails (a contract
      // skew, the forced-restart trigger), is recycled.
      const holder = await liveServingHolder();
      if (holder !== undefined) {
        try {
          const next = await spec.connect();
          spec.log.info(
            { hostId: spec.hostId, pid: holder },
            "adopted live daemon survivor (no recycle)",
          );
          hold(next);
          return;
        } catch (err) {
          spec.log.warn(
            { hostId: spec.hostId, pid: holder, err },
            "live survivor failed handshake (skew/unreachable) — recycling it",
          );
          await killLiveHolder(holder);
        }
      }
      await spawnConnectHold();
    },

    async serializeRestart(run: () => Promise<void>): Promise<void> {
      // Coalesce: a second trigger while a restart is in flight awaits it and
      // returns without starting its own recycle (one session capture, not two).
      const inFlight = restartInFlight;
      if (inFlight) {
        await inFlight;
        return;
      }
      // A real restart (we hold a connection) flips to `restarting` so the UI
      // shows the recycle; the boot path uses `adoptOrEnsure`, not this, so a
      // cold start never emits `restarting`.
      if (conn) emit("restarting", conn.identity, conn.startedAt);
      const p = run();
      restartInFlight = p;
      try {
        await p;
      } finally {
        if (restartInFlight === p) restartInFlight = undefined;
      }
    },
  };
}
