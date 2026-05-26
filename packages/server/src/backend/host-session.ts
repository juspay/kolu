/**
 * HostSession — owns the SSH stdio oRPC connection to one remote
 * `kolu agent --stdio` peer plus the connection state machine.
 *
 * One HostSession per host; multiple terminals on the same host share
 * one session. State machine + heartbeat live here (R-2 pre-impl
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
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import type { agentContract } from "kolu-common/agentContract";
import type { ConnectionState } from "kolu-common/surface";
import { remoteAgentCommand } from "../install.ts";
import { log } from "../log.ts";
import { StdioRPCLink } from "./stdio-client.ts";

/** Zed-ported heartbeat constants. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_TIMEOUT_MS = 5_000;
export const MAX_MISSED_HEARTBEATS = 5;
export const MAX_RECONNECT_ATTEMPTS = 3;

type InternalState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "heartbeat-missed"; count: number }
  | { kind: "reconnecting"; attempt: number }
  | {
      kind: "disconnected";
      reason:
        | "exhausted"
        | "server-not-running"
        | "user-closed"
        | "init-failed";
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

/** Typed client against `agentContract`. */
export type AgentClient = ContractRouterClient<typeof agentContract>;

export class HostSession {
  private state: InternalState = { kind: "connecting" };
  private readonly terminals = new Set<string>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private subprocess:
    | ChildProcessByStdio<Writable, Readable, Readable>
    | undefined;
  private link: StdioRPCLink | undefined;
  /** Typed agent client — undefined until `connect()` finishes. */
  client: AgentClient | undefined;

  constructor(public readonly host: string) {
    log.info({ host }, "HostSession: created");
  }

  registerTerminal(id: string): void {
    this.terminals.add(id);
  }

  unregisterTerminal(id: string): void {
    this.terminals.delete(id);
  }

  connectionState(): ConnectionState {
    return projectExternal(this.state);
  }

  onStateChange(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.connectionState());
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
      for (const cb of this.stateListeners) {
        try {
          cb(nextExternal);
        } catch (err) {
          log.error(
            { host: this.host, err },
            "HostSession: state listener threw",
          );
        }
      }
    }
  }

  /**
   * Spawn `ssh -tt $host kolu --stdio` and wire the oRPC client to its
   * stdio. Caller (e.g. `installSshAgent` RPC handler) should call
   * `installAgent(host)` first to ensure the binary is on the remote.
   *
   * Returns once the subprocess is spawned and the typed client is
   * ready. State transitions to `connected`. If spawn fails, transitions
   * to `disconnected` with `reason: "init-failed"` and rethrows.
   */
  async connect(): Promise<void> {
    if (this.subprocess) {
      log.warn({ host: this.host }, "HostSession.connect: already connected");
      return;
    }
    const argv = remoteAgentCommand(this.host);
    log.info({ host: this.host, argv }, "HostSession: spawning ssh subprocess");

    // First arg is "ssh", rest are args. spawn() takes them split.
    const [cmd, ...args] = argv;
    if (!cmd) {
      this.transition({ kind: "disconnected", reason: "init-failed" });
      throw new Error("HostSession.connect: empty remoteAgentCommand");
    }
    const subprocess = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessByStdio<Writable, Readable, Readable>;
    this.subprocess = subprocess;

    // Pipe stderr to our log so ssh errors / agent log lines are visible.
    subprocess.stderr.on("data", (chunk: Buffer) => {
      log.warn(
        { host: this.host, msg: chunk.toString("utf8").trim() },
        "HostSession: subprocess stderr",
      );
    });
    subprocess.on("exit", (code, signal) => {
      log.info(
        { host: this.host, code, signal },
        "HostSession: subprocess exited",
      );
      this.transition({
        kind: "disconnected",
        reason: code === 0 ? "user-closed" : "server-not-running",
      });
      this.subprocess = undefined;
      this.client = undefined;
      this.link?.dispose();
      this.link = undefined;
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
    });
    subprocess.on("error", (err) => {
      log.error({ host: this.host, err }, "HostSession: subprocess error");
    });

    this.link = new StdioRPCLink({
      stdin: subprocess.stdin,
      stdout: subprocess.stdout,
    });
    this.client = createORPCClient<AgentClient>(this.link);

    this.transition({ kind: "connected" });
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.tickHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async tickHeartbeat(): Promise<void> {
    if (!this.client) return;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("heartbeat timeout")),
        HEARTBEAT_TIMEOUT_MS,
      ),
    );
    try {
      await Promise.race([this.client.heartbeat(), timeout]);
      // Reset missed counter on success.
      if (this.state.kind === "heartbeat-missed") {
        this.transition({ kind: "connected" });
      }
    } catch (err) {
      const missed =
        this.state.kind === "heartbeat-missed" ? this.state.count + 1 : 1;
      log.warn(
        { host: this.host, missed, err },
        "HostSession: heartbeat missed",
      );
      if (missed >= MAX_MISSED_HEARTBEATS) {
        this.transition({ kind: "reconnecting", attempt: 1 });
        void this.attemptReconnect();
      } else {
        this.transition({ kind: "heartbeat-missed", count: missed });
      }
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.subprocess?.kill();
    this.subprocess = undefined;
    this.link?.dispose();
    this.link = undefined;
    this.client = undefined;

    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      this.transition({ kind: "reconnecting", attempt });
      try {
        await this.connect();
        return;
      } catch (err) {
        log.warn(
          { host: this.host, attempt, err },
          "HostSession: reconnect attempt failed",
        );
      }
    }
    this.transition({ kind: "disconnected", reason: "exhausted" });
  }

  dispose(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.subprocess?.kill();
    this.link?.dispose();
    this.transition({ kind: "disconnected", reason: "user-closed" });
    this.stateListeners.clear();
    this.terminals.clear();
  }
}
