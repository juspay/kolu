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

import { createConnection } from "node:net";
import { gatePid, isHolderLive, type Logger } from "@kolu/surface-daemon";
import type { DaemonDriver } from "./driver.ts";
import { waitForPidGone } from "./waitForPidGone.ts";

/** The set of daemon states the endpoint reports — the single source of truth.
 *  Consumers that re-shape this surface (e.g. kolu's `DaemonStatusSchema`) derive
 *  their state enum from this tuple so a new state is a compile-time obligation,
 *  not a silent omission. */
export const ENDPOINT_STATES = [
  "connecting",
  "connected",
  "degraded",
  "dead",
] as const;

export type EndpointState = (typeof ENDPOINT_STATES)[number];

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
}

/** Poll until a connection to `socketPath` is accepted, or the ceiling passes.
 *  Resolves `true` if the socket came up, `false` on timeout. Each probe opens
 *  and immediately closes a bare socket — the endpoint's real (handshaken)
 *  connection is made once by `spec.connect()` after this resolves. */
function waitForSocket(
  socketPath: string,
  ceilingMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + ceilingMs;
  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      const sock = createConnection(socketPath);
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, pollMs);
      });
    };
    attempt();
  });
}

export function createEndpoint<C, I>(spec: EndpointSpec<C, I>): Endpoint<C, I> {
  const socketReadyMs = spec.socketReadyMs ?? 30_000;
  const socketPollMs = spec.socketPollMs ?? 50;
  let conn: DaemonConnection<C, I> | undefined;

  const emit = (state: EndpointState, identity?: I, startedAt?: number): void =>
    spec.onStatus(spec.hostId, { state, identity, startedAt });

  return {
    current: () => conn,

    async ensure(): Promise<void> {
      emit("connecting");

      // ALWAYS RECYCLE: a live survivor is killed, never adopted, so no
      // survival hazard can open. (Adoption that preserves a session is B3.)
      const holder = gatePid(spec.gatePath);
      if (holder !== undefined && isHolderLive(holder)) {
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
      }

      await spec.driver.spawn();

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
    },
  };
}
