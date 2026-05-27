/**
 * `HostSession` — ref-counted ssh subprocess per `(host, agentPath)`.
 *
 * Row 6 of the falsifiability checklist: watching multiple things on the
 * same host shares ONE ssh subprocess + ONE stdio link. New subscriptions
 * `acquire()` a session (spawning if absent, incrementing a ref count if
 * present); each subscription's matching `release()` decrements the count
 * and tears down the session when it hits zero.
 *
 * Connection state lifecycle (row 4 — snapshot-then-delta on listeners):
 *
 *     copying      ──nixCopy ok──▶ connecting
 *     connecting   ──first RPC──▶ connected
 *     connected    ──read end ──▶ disconnected ──reconnect──▶ copying
 *
 * New listeners attached via `onState` see the *current* state
 * synchronously (the snapshot) before any deltas arrive. The cell-shape
 * matches what the framework's `useCell` consumer expects.
 *
 * Row 12 (reconnect → state reconciles, no ghosts): when the link dies,
 * we tear down the current stdio client and respawn after a short
 * backoff. Re-subscribe is handled by the framework's
 * `ClientRetryPlugin` — the parent's collection subscriber receives a
 * fresh snapshot via the stdio link's snapshot-then-delta invariant, and
 * processes that ended during the gap drop out cleanly.
 *
 * Row 9 (remote command builder): the spawn invocation is the agent's
 * argv — `ssh $host $agentPath/bin/process-monitor-agent --stdio`. The
 * shape mirrors R-2's `install.ts` `remoteAgentCommand(host, path?)`.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import { inMemoryCell } from "@kolu/surface/server";
import type { ContractRouterClient } from "@orpc/contract";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { surface } from "../common/surface";
import { provisionAgent } from "./nixCopy";

export type ConnectionState =
  | "copying"
  | "connecting"
  | "connected"
  | "disconnected";

export interface HostSessionState {
  connection: ConnectionState;
  /** Free-form progress lines (last 20) — `nix copy` output, ssh
   *  start, agent fatal-error tails. */
  progressLines: readonly string[];
  /** Last error if `connection === "disconnected"`. */
  lastError: string | null;
}

export interface HostSessionOptions {
  host: string;
  agentPath: string;
  /** How long between disconnect and reconnect attempts. Default 2s. */
  reconnectDelayMs?: number;
}

export type AgentClient = ContractRouterClient<
  typeof surface.contract,
  ClientRetryPluginContext
>;

const MAX_PROGRESS_LINES = 20;

export class HostSession {
  private refCount = 0;
  private child: ChildProcess | null = null;
  private clientPromise: Promise<AgentClient> | null = null;
  /** The session's observable state — current snapshot + delta stream
   *  in one. The framework's `inMemoryCell` owns the snapshot-then-
   *  delta contract, so this class doesn't hand-roll a listener set or
   *  a synchronous initial fire. */
  private readonly stateCell = inMemoryCell<HostSessionState>({
    connection: "copying",
    progressLines: [],
    lastError: null,
  });
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly opts: HostSessionOptions) {}

  /** Snapshot of the current session state. */
  current(): HostSessionState {
    return this.stateCell.current();
  }

  /** Snapshot-then-delta listener. Fires `cb(currentState)`
   *  synchronously before returning, then on every subsequent state
   *  change. Returns an `unsubscribe` fn. */
  onState(cb: (s: HostSessionState) => void): () => void {
    return this.stateCell.consume({
      onEvent: cb,
      onError: () => {
        /* the cell never errors — onError is required by Channel<T> shape */
      },
    });
  }

  /** Acquire a reference. The first acquire spawns the ssh subprocess
   *  and provisions the closure (if needed). Resolves with a typed
   *  client once the link is live. Subsequent acquires share the same
   *  client without re-spawning. */
  async acquire(): Promise<AgentClient> {
    this.refCount += 1;
    if (this.clientPromise === null) {
      this.clientPromise = this.spawn();
    }
    return this.clientPromise;
  }

  /** Release a reference. When refs reach zero, tear down the session. */
  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) this.teardown("ref-count reached zero");
  }

  /** Immediately drop the session regardless of ref count. Used on
   *  server shutdown. */
  destroy(): void {
    this.destroyed = true;
    this.teardown("session destroyed");
  }

  private updateState(patch: Partial<HostSessionState>): void {
    const next: HostSessionState = { ...this.stateCell.current(), ...patch };
    // Cap the progress-lines tail so we don't OOM on a long-running
    // session that produces many copy/restart cycles.
    if (patch.progressLines !== undefined) {
      next.progressLines = patch.progressLines.slice(-MAX_PROGRESS_LINES);
    }
    this.stateCell.set(next);
  }

  private addProgress(line: string): void {
    this.updateState({
      progressLines: [...this.stateCell.current().progressLines, line],
    });
  }

  private async spawn(): Promise<AgentClient> {
    this.updateState({ connection: "copying", lastError: null });
    const provision = await provisionAgent({
      host: this.opts.host,
      agentPath: this.opts.agentPath,
      onProgress: (line) => this.addProgress(line),
    });
    if (!provision.ok) {
      const reason = provision.reason ?? "nix copy failed";
      this.updateState({ connection: "disconnected", lastError: reason });
      this.scheduleReconnect();
      throw new Error(reason);
    }

    this.updateState({ connection: "connecting" });
    const child = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ServerAliveInterval=10",
        this.opts.host,
        `${this.opts.agentPath}/bin/process-monitor-agent`,
        "--stdio",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim().length > 0) this.addProgress(`[agent stderr] ${line}`);
      }
    });

    child.on("exit", (code, signal) => {
      const reason = `agent exited (code=${code}, signal=${signal})`;
      this.addProgress(reason);
      this.updateState({ connection: "disconnected", lastError: reason });
      this.child = null;
      this.clientPromise = null;
      if (!this.destroyed && this.refCount > 0) this.scheduleReconnect();
    });

    child.on("error", (err) => {
      const reason = `ssh failed to spawn: ${err.message}`;
      this.addProgress(reason);
      this.updateState({ connection: "disconnected", lastError: reason });
      this.child = null;
      this.clientPromise = null;
      if (!this.destroyed && this.refCount > 0) this.scheduleReconnect();
    });

    if (child.stdin === null || child.stdout === null) {
      throw new Error("ssh subprocess has no stdin/stdout — unreachable");
    }
    const client = createStdioCellsClient<typeof surface.contract>({
      read: child.stdout,
      write: child.stdin,
    });

    // Lesson #6: defer "connected" until the first RPC roundtrips.
    // We don't have a synchronous signal from the link, so we
    // optimistically transition once `acquire()` is called and the
    // first real subscription completes — see `markConnectedOnce`.
    return client;
  }

  /** Called by the parent's router after the first RPC roundtrips
   *  successfully. Transitions to `connected` exactly once per spawn. */
  markConnected(): void {
    if (this.stateCell.current().connection === "connecting")
      this.updateState({ connection: "connected" });
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;
    const delay = this.opts.reconnectDelayMs ?? 2000;
    this.addProgress(`reconnecting in ${delay}ms…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed || this.refCount === 0) return;
      this.clientPromise = this.spawn();
      this.clientPromise.catch(() => {
        /* spawn surfaces failure via state; we just clear the promise */
      });
    }, delay);
  }

  private teardown(reason: string): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.child !== null) {
      this.addProgress(`tearing down (${reason})`);
      try {
        this.child.kill("SIGTERM");
      } catch {
        /* best-effort */
      }
      this.child = null;
    }
    this.clientPromise = null;
  }
}

// ── HostSession pool (one per (host, agentPath)) ────────────────────────

const pool = new Map<string, HostSession>();

/** Get-or-create a `HostSession` for `(host, agentPath)`. Multiple
 *  callers asking for the same pair share the same session. */
export function getHostSession(opts: HostSessionOptions): HostSession {
  const key = `${opts.host}::${opts.agentPath}`;
  let session = pool.get(key);
  if (session === undefined) {
    session = new HostSession(opts);
    pool.set(key, session);
  }
  return session;
}

/** Destroy every pooled session (e.g. on server shutdown). */
export function destroyAllSessions(): void {
  for (const session of pool.values()) session.destroy();
  pool.clear();
}
