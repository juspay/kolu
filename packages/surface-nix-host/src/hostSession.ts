/**
 * `HostSession<C>` — ref-counted ssh subprocess per `(host, drvPath)`,
 * generic over a `@kolu/surface` contract type `C`.
 *
 * Multiple subscriptions against the same host share ONE ssh
 * subprocess + ONE stdio link. New consumers `acquire()` a session
 * (spawning if absent, bumping a ref count if present); each
 * subscription's matching `release()` decrements the count and tears
 * down the session when it hits zero.
 *
 * Connection state lifecycle (snapshot-then-delta on `onState`):
 *
 *     copying      ──provisionAgent ok──▶ connecting
 *     connecting   ──first RPC ────────▶ connected
 *     connected    ──read end  ────────▶ disconnected ──reconnect──▶ copying
 *     disconnected ──gave up (N fails)──▶ failed   (terminal; `reconnect()` re-arms)
 *
 * New listeners attached via `onState` see the *current* state
 * synchronously before any deltas arrive — matching the snapshot-then-
 * delta contract `@kolu/surface`'s `useCell` consumers expect.
 *
 * When the link dies (the agent process exits, ssh drops), the session
 * clears the stdio client and respawns after an exponentially-backed-
 * off delay, capped at 60 s, with `MAX_CONSECUTIVE_FAILURES` as a
 * give-up gate (so a permanently-misconfigured remote — e.g.
 * `trusted-users` not granting the parent's user — fails loudly
 * instead of spinning).
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createStdioCellsClient } from "@kolu/surface/links/stdio";
import { inMemoryCell } from "@kolu/surface/server";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { buildAgentCommand, forEachLine } from "./host";
import { provisionAgent } from "./nixCopy";

export type ConnectionState =
  | "copying"
  | "connecting"
  | "connected"
  | "disconnected"
  // Terminal: the reconnect loop exhausted `MAX_CONSECUTIVE_FAILURES`
  // and stopped retrying. Distinct from `disconnected` (which is the
  // brief gap between attempts) so consumers can tell "still trying"
  // from "gave up — needs intervention". `reconnect()` re-arms it.
  | "failed";

export interface HostSessionState {
  connection: ConnectionState;
  /** Free-form progress lines (last 20) — `nix copy` output, ssh
   *  start, agent fatal-error tails. */
  progressLines: readonly string[];
  /** Last error if `connection === "disconnected"` or `"failed"`. */
  lastError: string | null;
}

export interface HostSessionOptions {
  host: string;
  /** Path to the agent's `.drv`. The session ships this derivation to
   *  the target host (no-op for localhost) and realises it there to
   *  get a target-arch-correct output path. */
  drvPath: string;
  /** Executable name inside the realised closure (e.g.
   *  `process-monitor-agent`, `kolu-terminal-agent`). The full spawn
   *  path is `${agentPath}/bin/${binary}`. */
  binary: string;
  /** How long between disconnect and reconnect attempts. Default 2s. */
  reconnectDelayMs?: number;
}

/** The typed RPC client produced by a successful `acquire`/`pin`/
 *  `currentClient`. Generic so consumers can name their own:
 *
 *  ```ts
 *  type MyClient = AgentClient<typeof myContract>;
 *  ``` */
export type AgentClient<C extends AnyContractRouter> = ContractRouterClient<
  C,
  ClientRetryPluginContext
>;

const MAX_PROGRESS_LINES = 20;
const MAX_CONSECUTIVE_FAILURES = 5;

export class HostSession<C extends AnyContractRouter> {
  private refCount = 0;
  private child: ChildProcess | null = null;
  private clientPromise: Promise<AgentClient<C>> | null = null;
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
   *  retrying and transition to the terminal `failed` state — useful
   *  when the remote nix-daemon won't accept the closure at all and the
   *  loop would otherwise spam forever). Reset to 0 on a successful
   *  `markConnected` or a manual `reconnect()`. */
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

  /** Acquire a scoped reference. The first acquire spawns the ssh
   *  subprocess and provisions the closure (if needed). Resolves with a
   *  typed client once the link is live. Subsequent acquires share the
   *  same client without re-spawning. **Callers must match each
   *  successful `acquire` with a `release`** — use `pin()` for the
   *  long-lived bridge case.
   *
   *  Order matters: spawn FIRST, then bump refCount on success. The
   *  reverse (the old code's pattern) leaked a ref when `spawn()`
   *  rejected — the `await` threw, the caller's try/finally never ran,
   *  and `refCount` stayed bumped forever. */
  async acquire(): Promise<AgentClient<C>> {
    const client = await this.ensureSpawned();
    this.refCount += 1;
    return client;
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
   *  otherwise hide as a leak.
   *
   *  Unlike `acquire()`, pin bumps refCount FIRST — the intent is "keep
   *  this session alive across spawn failures so the reconnect loop
   *  keeps trying", which requires refCount > 0 for `scheduleReconnect`
   *  to fire its retry. */
  pin(): Promise<AgentClient<C>> {
    this.refCount += 1;
    return this.ensureSpawned();
  }

  /** Lazy-start the spawn cycle. Idempotent — multiple callers race
   *  onto the same in-flight `clientPromise`. Separated from `acquire`
   *  so `acquire` can fail-safe on its ref bump and `pin` can do the
   *  opposite. */
  private ensureSpawned(): Promise<AgentClient<C>> {
    if (this.clientPromise === null) {
      this.clientPromise = this.spawn();
    }
    return this.clientPromise;
  }

  /** Immediately drop the session regardless of ref count. Used on
   *  server shutdown. */
  destroy(): void {
    this.destroyed = true;
    this.teardown("session destroyed");
  }

  /** Has `destroy()` been called? Used by the bridge's outer pump loop
   *  to break out cleanly on shutdown. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The currently in-flight client promise (or `null` between a child
   *  exit and `scheduleReconnect`'s timer firing). Each `spawn()` call
   *  reassigns `clientPromise`, so the bridge can detect "the agent
   *  was respawned" by observing identity drift between successive
   *  reads. */
  currentClient(): Promise<AgentClient<C>> | null {
    return this.clientPromise;
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

  private async spawn(): Promise<AgentClient<C>> {
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
    const { command, args } = buildAgentCommand({
      host: this.opts.host,
      agentPath: realisedAgentPath,
      binary: this.opts.binary,
    });
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
    const client = createStdioCellsClient<C>({
      read: child.stdout,
      write: child.stdin,
    });

    // Defer "connected" until the first RPC actually roundtrips —
    // consumers signal that via `markConnected()`. The stdio link has
    // no synchronous "open" event we could hook here.
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

  /** Re-arm a session that gave up (`connection === "failed"`). Resets
   *  the consecutive-failure gate and respawns immediately — the bridge
   *  picks up the fresh client via `currentClient()` identity drift,
   *  the same path the automatic reconnect timer uses, minus the backoff
   *  wait. No-op if the session is destroyed, unreferenced, or a spawn
   *  is already in flight (so a double-tapped "Reconnect" can't stack
   *  spawns). The give-up gate left `reconnectTimer` and `clientPromise`
   *  null, so a genuinely-failed session always passes the guard. */
  reconnect(): void {
    if (this.destroyed || this.refCount === 0) return;
    if (this.clientPromise !== null || this.reconnectTimer !== null) return;
    this.consecutiveFailures = 0;
    this.clientPromise = this.spawn();
    this.clientPromise.catch(() => {
      /* spawn surfaces failure via state; we just clear the promise */
    });
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
        `gave up after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — fix the underlying issue (often: remote nix-daemon needs your user in 'trusted-users' to accept unsigned closures), then reconnect`,
      );
      // Move off `disconnected` so consumers can distinguish "still
      // retrying" from "gave up". `lastError` is already set by the
      // spawn-failure path that led here; preserve it.
      this.updateState({ connection: "failed" });
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

// ── HostSession pool (one per (host, drvPath, binary)) ─────────────────

const pool = new Map<string, HostSession<AnyContractRouter>>();

/** Get-or-create a `HostSession` for `(host, drvPath, binary)`.
 *  Multiple callers asking for the same triple share the same session.
 *
 *  Generic over `C extends AnyContractRouter` — the contract type the
 *  agent on the other side serves. Pass it explicitly so the returned
 *  session's `acquire()`/`pin()`/`currentClient()` return a typed
 *  client:
 *
 *  ```ts
 *  const session = getHostSession<typeof myContract>({...});
 *  const client = await session.pin();  // ContractRouterClient<typeof myContract, …>
 *  ``` */
export function getHostSession<C extends AnyContractRouter>(
  opts: HostSessionOptions,
): HostSession<C> {
  const key = `${opts.host}::${opts.drvPath}::${opts.binary}`;
  let session = pool.get(key);
  if (session === undefined) {
    session = new HostSession<C>(opts) as HostSession<AnyContractRouter>;
    pool.set(key, session);
  }
  return session as HostSession<C>;
}

/** Destroy every pooled session (e.g. on server shutdown). */
export function destroyAllSessions(): void {
  for (const session of pool.values()) session.destroy();
  pool.clear();
}
