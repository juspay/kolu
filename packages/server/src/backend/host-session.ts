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
import type { agentSurface } from "kolu-common/agentSurface";
import type { ConnectionState } from "kolu-common/surface";
import { StdioRPCLink } from "@kolu/surface/links/stdio";
import { remoteAgentCommand } from "../install.ts";
import { log } from "../log.ts";

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

/** Typed client against `agentSurface`. Sole client now that the
 *  Surface migration is complete; the legacy `agentContract`-based
 *  `AgentClient` was removed along with `agentContract.ts`. */
export type AgentSurfaceClient = ContractRouterClient<
  typeof agentSurface.contract
>;

export class HostSession {
  private state: InternalState = { kind: "connecting" };
  private readonly terminals = new Set<string>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private subprocess:
    | ChildProcessByStdio<Writable, Readable, Readable>
    | undefined;
  private link: StdioRPCLink | undefined;
  /** Typed surface client — undefined until `connect()` finishes. */
  surfaceClient: AgentSurfaceClient | undefined;

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
      this.surfaceClient = undefined;
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
      // Framework-direction-neutral naming: the client reads from the
      // subprocess's stdout (responses) and writes to its stdin (requests).
      read: subprocess.stdout,
      write: subprocess.stdin,
    });
    this.surfaceClient = createORPCClient<AgentSurfaceClient>(this.link);

    // Don't transition to "connected" until we've actually heard from
    // the agent. First-time `nix run` on a cold remote can take
    // minutes to realise the closure; starting the heartbeat clock now
    // would tear down the connection before the agent even boots. The
    // first successful RPC (typically `terminal.spawn` from
    // RemoteBackend) calls `markReady()` to flip the state and start
    // the heartbeat loop.
    log.info(
      { host: this.host },
      "HostSession.connect: subprocess spawned; waiting for first RPC",
    );
  }

  /** Called by RemoteBackend after the first RPC roundtrips. Marks the
   *  session ready and starts the heartbeat loop. Idempotent. */
  markReady(): void {
    if (this.state.kind === "connected") return;
    this.transition({ kind: "connected" });
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.tickHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async tickHeartbeat(): Promise<void> {
    if (!this.surfaceClient) return;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("heartbeat timeout")),
        HEARTBEAT_TIMEOUT_MS,
      ),
    );
    try {
      await Promise.race([
        this.surfaceClient.surface.system.heartbeat(),
        timeout,
      ]);
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
    this.surfaceClient = undefined;

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
