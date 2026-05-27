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
import { buildAgentCommand, forEachLine } from "./host";
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
  /** Path to the agent's `.drv`. The session ships this derivation to
   *  the target host (no-op for localhost) and realises it there to
   *  get a target-arch-correct output path. */
  drvPath: string;
  /** How long between disconnect and reconnect attempts. Default 2s. */
  reconnectDelayMs?: number;
}

export type AgentClient = ContractRouterClient<
  typeof surface.contract,
  ClientRetryPluginContext
>;

const MAX_PROGRESS_LINES = 20;
const MAX_CONSECUTIVE_FAILURES = 5;

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
  /** Count of consecutive failures since the last successful "connected"
   *  transition. Drives the exponential backoff on `scheduleReconnect`
   *  AND the give-up gate (after `MAX_CONSECUTIVE_FAILURES` we stop
   *  retrying and surface a permanent disconnect — useful when the
   *  remote nix-daemon won't accept the closure at all and the loop
   *  would otherwise spam forever). */
  private consecutiveFailures = 0;

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
   *  client without re-spawning. **Callers must match each `acquire`
   *  with a `release`** — use `pin()` for the long-lived bridge case. */
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

  /** Pin the session open for the lifetime of the parent process —
   *  bumps the ref count by one *without* a matching `release`, so the
   *  session stays warm even when transient callers (e.g. the `kill`
   *  procedure's per-call acquire/release pair) bring the count to
   *  zero in between. Use ONCE per HostSession from the long-lived
   *  bridge code. Encodes the "this session must outlive its
   *  short-lived consumers" intent that an unmatched `acquire()` would
   *  otherwise hide as a leak. */
  pin(): Promise<AgentClient> {
    return this.acquire();
  }

  /** Immediately drop the session regardless of ref count. Used on
   *  server shutdown. */
  destroy(): void {
    this.destroyed = true;
    this.teardown("session destroyed");
  }

  private updateState(patch: Partial<HostSessionState>): void {
    const prev = this.stateCell.current();
    const next: HostSessionState = { ...prev, ...patch };
    // Cap the progress-lines tail so we don't OOM on a long-running
    // session that produces many copy/restart cycles.
    if (patch.progressLines !== undefined) {
      next.progressLines = patch.progressLines.slice(-MAX_PROGRESS_LINES);
    }
    if (patch.connection !== undefined)
      this.logTransition(prev.connection, patch.connection);
    if (patch.lastError !== undefined && patch.lastError !== null) {
      process.stderr.write(
        `[host:${this.opts.host}] lastError: ${patch.lastError}\n`,
      );
    }
    this.stateCell.set(next);
  }

  /** Parent-side lifecycle event (nix copy progress, ssh spawn errors,
   *  reconnect timer, teardown). Logged to stderr with a `[local]` tag
   *  and accumulated in the connection cell's progress ring. */
  private addLocalProgress(line: string): void {
    process.stderr.write(`[host:${this.opts.host} local] ${line}\n`);
    this.updateState({
      progressLines: [
        ...this.stateCell.current().progressLines,
        `[local] ${line}`,
      ],
    });
  }

  /** A line the *remote* agent wrote to its own stderr, forwarded
   *  through the ssh subprocess. Tagged `[remote]` so the parent's
   *  own activity is distinguishable in the same log. */
  private addRemoteProgress(line: string): void {
    process.stderr.write(`[host:${this.opts.host} remote] ${line}\n`);
    this.updateState({
      progressLines: [
        ...this.stateCell.current().progressLines,
        `[remote] ${line}`,
      ],
    });
  }

  private logTransition(from: ConnectionState, to: ConnectionState): void {
    if (from === to) return;
    process.stderr.write(
      `[host:${this.opts.host} local] connection: ${from} → ${to}\n`,
    );
  }

  private async spawn(): Promise<AgentClient> {
    this.updateState({ connection: "copying", lastError: null });
    const provision = await provisionAgent({
      host: this.opts.host,
      drvPath: this.opts.drvPath,
      onProgress: (line) => this.addLocalProgress(line),
    });
    if (!provision.ok) {
      this.updateState({
        connection: "disconnected",
        lastError: provision.reason,
      });
      this.scheduleReconnect();
      throw new Error(provision.reason);
    }
    const realisedAgentPath = provision.agentPath;

    this.updateState({ connection: "connecting" });
    const { command, args } = buildAgentCommand(
      this.opts.host,
      realisedAgentPath,
    );
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) =>
      forEachLine(chunk, (line) => this.addRemoteProgress(line)),
    );

    child.on("exit", (code, signal) => {
      const reason = `agent exited (code=${code}, signal=${signal})`;
      this.addLocalProgress(reason);
      this.updateState({ connection: "disconnected", lastError: reason });
      this.child = null;
      this.clientPromise = null;
      if (!this.destroyed && this.refCount > 0) this.scheduleReconnect();
    });

    child.on("error", (err) => {
      const reason = `ssh failed to spawn: ${err.message}`;
      this.addLocalProgress(reason);
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
    if (this.stateCell.current().connection === "connecting") {
      this.consecutiveFailures = 0;
      this.updateState({ connection: "connected" });
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== null) return;
    // Exponential backoff is keyed on attempts-so-far, not "this is
    // attempt N after the failure". The previous code post-incremented
    // and then subtracted one to compensate (`2 ** (count - 1)`), which
    // is correct but reads like two off-by-ones cancelling. Decouple:
    // compute the delay from the pre-increment count, then bump.
    // Sequence: 2s, 4s, 8s, 16s — capped at 60s — then "gave up" on
    // the next call.
    const attemptsSoFar = this.consecutiveFailures;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.addLocalProgress(
        `gave up after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — fix the underlying issue (often: remote nix-daemon needs your user in 'trusted-users' to accept unsigned closures) and restart the parent`,
      );
      return;
    }
    const baseDelay = this.opts.reconnectDelayMs ?? 2000;
    const delay = Math.min(baseDelay * 2 ** attemptsSoFar, 60_000);
    this.addLocalProgress(
      `reconnecting in ${delay}ms… (attempt ${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
    );
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
      this.addLocalProgress(`tearing down (${reason})`);
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

// ── HostSession pool (one per (host, drvPath)) ──────────────────────────

const pool = new Map<string, HostSession>();

/** Get-or-create a `HostSession` for `(host, drvPath)`. Multiple
 *  callers asking for the same pair share the same session. */
export function getHostSession(opts: HostSessionOptions): HostSession {
  const key = `${opts.host}::${opts.drvPath}`;
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
