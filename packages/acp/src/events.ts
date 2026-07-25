/**
 * The vocabulary of things worth showing about a session.
 *
 * Its own module because two layers speak it and neither should depend on the
 * other: the supervisor PRODUCES these events and the renderer CONSUMES them.
 * With the union living in the renderer, the supervisor had to import its
 * consumer to describe its own output — an inversion that only gets harder to
 * undo once a third producer exists.
 */

import type { SessionNotification } from "@agentclientprotocol/sdk";

export type SessionUpdate = SessionNotification["update"];

/** Everything the tile can show. Lifecycle entries are the harness duties the
 *  proxy owns; the rest is protocol traffic in one direction or the other. */
export type ProxyEvent =
  | { kind: "listening"; socketPath: string }
  | { kind: "adapterSpawned"; command: string; args: string[]; pid: number }
  | { kind: "adapterReady"; agentName: string; protocolVersion: number }
  /** Spawned, but not a word back yet. Emitted well before the handshake
   *  deadline so a wrong command explains itself in seconds, not a minute. */
  | { kind: "adapterSilent"; command: string; afterMs: number }
  | { kind: "adapterExited"; code: number | null; signal: string | null }
  | { kind: "adapterFailedToStart"; message: string }
  /** A generation that HAD become ready and then failed at runtime — distinct
   *  from one that never started, which is a different thing to go look at. */
  | { kind: "adapterLost"; message: string }
  | { kind: "adapterRespawning"; attempt: number; delayMs: number }
  | { kind: "sessionReady"; sessionId: string }
  | { kind: "clientConnected"; clients: number }
  | { kind: "clientDisconnected"; clients: number }
  | { kind: "prompt"; text: string }
  | { kind: "update"; update: SessionUpdate }
  | { kind: "permissionAutoAnswered"; title: string; optionName: string }
  | { kind: "permissionUnanswerable"; title: string }
  | { kind: "cancelRequested" }
  | { kind: "cancelGraceExpired"; graceMs: number }
  | { kind: "turnEnded"; stopReason: string }
  | { kind: "turnFailed"; message: string }
  /** A harness-level failure that is nobody's turn — reported on its own kind
   *  so it never inflates a turn-failure count or interrupts a healthy turn. */
  | { kind: "harnessError"; message: string };
