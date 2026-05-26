/**
 * HostSession — owns the SSH stdio oRPC connection to one remote
 * `kolu agent --stdio` peer plus the connection state machine.
 *
 * One HostSession per host; multiple terminals on the same host share
 * one session. The state machine + heartbeat live here (R-2 pre-impl
 * finding W1: HostSession and RemoteBackend are two axes — transport
 * vs. Backend-interface adapter).
 *
 * **State machine** (ported from Zed `/tmp/zed/crates/remote/src/remote_client.rs:157-293`):
 *
 *   Connecting ─┬──▶ Connected ──ping miss×5──▶ Reconnecting ─┬─▶ Connected
 *               │                                              │
 *               │                                              └─▶ Disconnected (3 attempts exhausted)
 *               │
 *               └──▶ Disconnected (initial connect failed)
 *
 * **Heartbeat** (Zed constants verbatim, `/tmp/zed/crates/remote/src/remote_client.rs:149-155`):
 *
 *   HEARTBEAT_INTERVAL  = 5s
 *   HEARTBEAT_TIMEOUT   = 5s
 *   MAX_MISSED          = 5
 *   MAX_RECONNECT_ATTEMPTS = 3
 *
 * **Per-terminal `connectionState` write seam** (R-2 finding D / W4):
 * The state machine fires `connectionStateChanged(newState)` events.
 * Each terminal known to this session gets the per-terminal
 * `connectionState` channel published. Subscribers (typically the
 * kolu server's metadata-aggregator wired into `RemoteBackend`)
 * propagate to `entry.meta.connectionState`.
 *
 * Prototype scope: the state machine + heartbeat are sketched
 * functionally but lifecycle (subprocess spawn, oRPC peer wiring,
 * reconnect logic) are marked TODO. The shape is what matters for
 * Plan B evaluation.
 */

import type { ConnectionState } from "kolu-common/surface";
import { log } from "../log.ts";

/** Zed-ported heartbeat constants. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_TIMEOUT_MS = 5_000;
export const MAX_MISSED_HEARTBEATS = 5;
export const MAX_RECONNECT_ATTEMPTS = 3;

/** Internal state machine state. The wire-visible `ConnectionState`
 *  enum (`"live" | "connecting" | "disconnected"`) is a projection —
 *  see `projectExternal()` below. */
type InternalState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "heartbeat-missed"; count: number }
  | { kind: "reconnecting"; attempt: number }
  | {
      kind: "disconnected";
      reason: "exhausted" | "server-not-running" | "user-closed";
    };

function projectExternal(s: InternalState): ConnectionState {
  switch (s.kind) {
    case "connecting":
    case "reconnecting":
      return "connecting";
    case "connected":
    case "heartbeat-missed":
      return "live";
    case "disconnected":
      return "disconnected";
  }
}

export class HostSession {
  private state: InternalState = { kind: "connecting" };
  private terminals = new Set<string>();
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(public readonly host: string) {
    // Subprocess spawn + oRPC peer wiring is the R-3 follow-up. The
    // prototype demonstrates the shape; the actual transport hookup
    // requires installAgent + child_process.spawn("ssh", …) + bridging
    // stdin/stdout to oRPC's standard-peer client. See
    // `packages/server/src/backend/install.ts:remoteAgentCommand` for
    // the spawn argv.
    log.info({ host }, "HostSession: created (transport wiring is R-3)");
  }

  /** Register a terminal as belonging to this session — when the
   *  state machine transitions, this terminal's `connectionState`
   *  channel gets published. */
  registerTerminal(id: string): void {
    this.terminals.add(id);
  }

  unregisterTerminal(id: string): void {
    this.terminals.delete(id);
  }

  /** External state for the connection. */
  connectionState(): ConnectionState {
    return projectExternal(this.state);
  }

  /** Subscribe to state changes — `RemoteBackend.terminalChannel(id,
   *  "connectionState")` consumers and the per-terminal metadata
   *  aggregator both listen here. Returns the unsubscribe fn. */
  onStateChange(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.connectionState()); // snapshot-then-delta
    return () => this.stateListeners.delete(cb);
  }

  private transition(next: InternalState): void {
    const prevExternal = projectExternal(this.state);
    this.state = next;
    const nextExternal = projectExternal(next);
    log.info(
      { host: this.host, state: next.kind, external: nextExternal },
      "HostSession: state transition",
    );
    if (prevExternal !== nextExternal) {
      for (const cb of this.stateListeners) cb(nextExternal);
    }
  }

  /** Initial connect. Sketched — full implementation:
   *
   *  1. await installAgent(host)
   *  2. spawn `ssh -tt host kolu agent --stdio` subprocess
   *  3. wire stdio to oRPC standard-peer client
   *  4. set state to `connected`, start heartbeat loop
   *  5. on `ssh` subprocess exit → reconnect attempt
   */
  async connect(): Promise<void> {
    log.warn(
      { host: this.host },
      "HostSession.connect: prototype stub — full impl in R-3",
    );
    // Sketch: the wiring chain.
    // await installAgent(this.host);
    // this.subprocess = spawn("ssh", await remoteAgentCommand(this.host), { stdio: ["pipe","pipe","inherit"] });
    // this.client = createClient<typeof agentContract>(...);
    // this.transition({ kind: "connected" });
    // this.startHeartbeat();
    this.transition({ kind: "connected" });
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      // Real impl: `await this.client.heartbeat()` with HEARTBEAT_TIMEOUT.
      // On timeout/throw, increment heartbeat-missed; on success, reset.
      // After MAX_MISSED, transition to reconnecting and try MAX_RECONNECT_ATTEMPTS.
      void this.tickHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async tickHeartbeat(): Promise<void> {
    // Prototype stub. Real implementation calls
    // `this.client.heartbeat()` with timeout HEARTBEAT_TIMEOUT_MS.
  }

  /** Tear down. */
  dispose(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.transition({ kind: "disconnected", reason: "user-closed" });
    this.stateListeners.clear();
    this.terminals.clear();
  }
}
