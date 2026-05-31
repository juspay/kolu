/**
 * `HostSession<C>` — ref-counted ssh subprocess per `(host, binary)`,
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
 *     copying      ──resolve/provision fail─▶ disconnected (backoff, then retry)
 *     connecting   ──first RPC ────────▶ connected
 *     connecting   ──watchdog timeout ─▶ disconnected (kill child, then retry)
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
 *
 * The `connecting` phase has its own escape hatch: a watchdog timer
 * (`connectTimeoutMs`, default 30 s) armed the moment the ssh child is
 * spawned. If the first RPC never roundtrips — the transport is up and
 * the child is alive, but the handshake wedges and the process never
 * exits — neither `markConnected` nor the child-exit handler ever fires,
 * so without the watchdog the session would hang in `connecting`
 * forever. The watchdog kills the child on timeout, which routes through
 * the ordinary exit handler into the same reconnect/give-up machinery.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { stdioLink } from "@kolu/surface/links/stdio";
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
  /** Resolve the agent's `.drv` for this host. Called at the top of
   *  *every* spawn attempt (not once up front), so the round-trip that
   *  picks the derivation — typically an ssh `nix-instantiate` arch
   *  probe via `resolveSystem` — lives inside the session's own
   *  reconnect machinery. An unreachable host makes the resolver reject,
   *  which the session treats exactly like a `provisionAgent` failure:
   *  `disconnected` → backoff → `failed`, re-armable via `reconnect()`.
   *  The session ships the resolved derivation to the target host (no-op
   *  for localhost) and realises it there to get a target-arch-correct
   *  output path.
   *
   *  Pass a constant as `() => Promise.resolve(drv)` when the caller
   *  already knows the path and has no probe to defer. */
  resolveDrvPath: () => Promise<string>;
  /** Executable name inside the realised closure (e.g.
   *  `process-monitor-agent`, `kolu-terminal-agent`). The full spawn
   *  path is `${agentPath}/bin/${binary}`. */
  binary: string;
  /** How long between disconnect and reconnect attempts. Default 2s. */
  reconnectDelayMs?: number;
  /** How long to wait for the first RPC after the ssh child is spawned
   *  before treating the `connecting` phase as wedged and killing the
   *  child (which then routes through the normal reconnect path).
   *  Default 30s. Guards against a transport that comes up but whose
   *  RPC handshake never completes — the child stays alive, so no
   *  `exit` fires and the session would otherwise hang in `connecting`
   *  indefinitely. Sized well under the consumer's own connect deadline
   *  (drishti's browser socket gives up at 60s) and above a healthy
   *  post-`nix copy` handshake, which is sub-second. */
  connectTimeoutMs?: number;
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
  /** The session's single pending phase-transition timer — either the
   *  reconnect-backoff delay (armed in `disconnected`) or the connect
   *  watchdog (armed in `connecting`). The two are never live at once:
   *  the watchdog is cleared the instant we leave `connecting`, and the
   *  backoff only arms after we've already left it. Folding them into
   *  one slot makes "at most one timer pending" a structural invariant
   *  rather than a discipline spread across handlers. */
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
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

  /** Clear the in-flight client handle. Centralizes the "no spawn in
   *  flight ⇒ `clientPromise` is null" invariant that three terminal
   *  paths must uphold: the child died (`handleChildDone`), the session
   *  was torn down (`teardown`), or the retry gate gave up
   *  (`scheduleReconnect`). `reconnect()`'s "already spawning?" guard and
   *  the bridge's `currentClient()` identity check both read this slot, so
   *  a path that forgets to null it strands `reconnect()` behind a stale
   *  *rejected* promise — exactly the bug where a `nix copy`-driven
   *  give-up (which throws before any child spawns, so `handleChildDone`
   *  never runs) left the slot non-null and made the "Reconnect" button a
   *  silent no-op. Naming it keeps the invariant searchable instead of
   *  conventional. */
  private clearClientPromise(): void {
    this.clientPromise = null;
  }

  private updateState(patch: Partial<HostSessionState>): void {
    const prev = this.stateCell.current();
    const next: HostSessionState = { ...prev, ...patch };
    // Cap the progress-lines tail so we don't OOM on a long-running
    // session that produces many copy/restart cycles.
    if (patch.progressLines !== undefined) {
      next.progressLines = patch.progressLines.slice(-MAX_PROGRESS_LINES);
    }
    if (patch.connection !== undefined) {
      this.logTransition(prev.connection, patch.connection);
      // Leaving `connecting` — by any path (connected, child exit, or a
      // provision failure that skips straight to disconnected) — disarms
      // the connect watchdog. This single choke-point is why the exit/
      // error handlers and `markConnected` don't each clear it by hand.
      // The guard names the actual transition (`connecting` → not-`connecting`)
      // rather than just the target, so the clear can't fire on unrelated
      // moves like `connected → disconnected`.
      if (prev.connection === "connecting" && patch.connection !== "connecting")
        this.clearTimer();
    }
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

  /** Arm the session's single pending timer. Auto-nulls `pendingTimer`
   *  before invoking `fn`, so a fired timer leaves the slot clean for
   *  the next arm (the firing callback typically transitions state,
   *  which would re-arm). Any prior timer must already be clear —
   *  callers arm only from states where `pendingTimer` is null. */
  private armTimer(delayMs: number, fn: () => void): void {
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      fn();
    }, delayMs);
  }

  /** Disarm the pending timer if one is set. Idempotent. */
  private clearTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private async spawn(): Promise<AgentClient<C>> {
    this.updateState({ connection: "copying", lastError: null });
    // Resolve the derivation first. This is where the arch probe (or any
    // other per-host drv lookup the caller deferred) actually runs, so a
    // host that's unreachable at probe time fails here — and is handled
    // identically to the `provisionAgent` failure below: surface the
    // error on the connection cell, schedule a backoff retry, and throw.
    // Folding the probe into the spawn cycle is what lets a boot-time
    // unreachable host degrade to `failed` instead of crashing the caller
    // before any session exists.
    const drvPath = await this.opts.resolveDrvPath().catch((err: unknown) => {
      // Mirror the `provisionAgent` failure path's message fidelity: that
      // branch surfaces `provision.reason` (always a real string), so a
      // non-Error rejection here mustn't degrade `lastError` to the string
      // "undefined" on the connection cell the UI reads.
      const reason = err instanceof Error ? err.message : String(err);
      this.updateState({ connection: "disconnected", lastError: reason });
      this.scheduleReconnect();
      throw err;
    });
    const provision = await provisionAgent({
      host: this.opts.host,
      drvPath,
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
    const connectTimeoutMs = this.opts.connectTimeoutMs ?? 30_000;
    const { command, args } = buildAgentCommand({
      host: this.opts.host,
      agentPath: realisedAgentPath,
      binary: this.opts.binary,
    });
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;

    // Set by the watchdog when it kills a wedged connect, so the shared
    // exit handler below reports the timeout — not the misleading
    // "agent exited (signal=SIGTERM)" the kill would otherwise produce.
    // Scoped to this spawn (one child, one handler), so it needs no
    // class field and can't bleed across reconnects.
    let connectTimedOut = false;

    child.stderr?.setEncoding("utf-8");
    child.stderr?.on("data", (chunk: string) =>
      forEachLine(chunk, (line) => this.addRemoteProgress(line)),
    );

    const handleChildDone = (reason: string): void => {
      this.addLocalProgress(reason);
      this.updateState({ connection: "disconnected", lastError: reason });
      this.child = null;
      this.clearClientPromise();
      if (!this.destroyed && this.refCount > 0) this.scheduleReconnect();
    };

    child.on("exit", (code, signal) => {
      handleChildDone(
        connectTimedOut
          ? `connect handshake timed out after ${connectTimeoutMs}ms (transport up, no first RPC)`
          : `agent exited (code=${code}, signal=${signal})`,
      );
    });

    child.on("error", (err) => {
      handleChildDone(`ssh failed to spawn: ${err.message}`);
    });

    if (child.stdin === null || child.stdout === null) {
      throw new Error("ssh subprocess has no stdin/stdout — unreachable");
    }
    const client = stdioLink<C>({
      read: child.stdout,
      write: child.stdin,
    });

    // Connect watchdog: the transport is up and the child is alive, but
    // the first RPC may never roundtrip (handshake wedges, process never
    // exits). `markConnected` and the exit handler are the only other
    // exits from `connecting`; neither fires here, so without this timer
    // the session hangs in `connecting` forever. Killing the child routes
    // through the exit handler into the normal reconnect/give-up path.
    // The state guard handles the benign race where `markConnected` just
    // fired (the choke-point already cleared us, but belt and suspenders).
    this.armTimer(connectTimeoutMs, () => {
      if (this.stateCell.current().connection !== "connecting") return;
      connectTimedOut = true;
      this.child?.kill("SIGTERM");
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
   *  spawns). On entering the terminal `failed` state the give-up gate
   *  clears `clientPromise` (via `clearClientPromise`) and leaves
   *  `pendingTimer` null, so a genuinely-failed session always passes the
   *  guard — including the `nix copy`-driven failure that never spawned a
   *  child. Like every spawn, this re-runs `resolveDrvPath` from scratch
   *  (it is not cached) — a manual re-arm re-pays whatever the resolver
   *  costs, e.g. an ssh arch probe. */
  reconnect(): void {
    if (this.destroyed || this.refCount === 0) return;
    if (this.clientPromise !== null || this.pendingTimer !== null) return;
    this.consecutiveFailures = 0;
    this.clientPromise = this.spawn();
    this.clientPromise.catch(() => {
      /* spawn surfaces failure via state; we just clear the promise */
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.pendingTimer !== null) return;
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
      // Clear the in-flight handle BEFORE entering the terminal state.
      // The provision-failure path (`nix copy` exited non-zero) throws
      // out of `spawn()` without ever creating a child, so
      // `handleChildDone` — the only other site that nulls the slot —
      // never ran; the slot still holds the last *rejected* spawn
      // promise. Without this, `reconnect()`'s `clientPromise !== null`
      // guard sees a non-null slot and silently no-ops, stranding a
      // genuinely-failed session. (See `clearClientPromise`.)
      this.clearClientPromise();
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
    this.armTimer(delay, () => {
      if (this.destroyed || this.refCount === 0) return;
      this.clientPromise = this.spawn();
      this.clientPromise.catch(() => {
        /* spawn surfaces failure via state; we just clear the promise */
      });
    });
  }

  private teardown(reason: string): void {
    this.clearTimer();
    if (this.child !== null) {
      this.addLocalProgress(`tearing down (${reason})`);
      try {
        this.child.kill("SIGTERM");
      } catch {
        /* best-effort */
      }
      this.child = null;
    }
    this.clearClientPromise();
  }
}

// ── HostSession pool (one per (host, binary)) ──────────────────────────

const pool = new Map<string, HostSession<AnyContractRouter>>();

/** Get-or-create a `HostSession` for `(host, binary)`.
 *  Multiple callers asking for the same pair share the same session.
 *
 *  The `.drv` is deliberately NOT part of the key: it's now resolved per
 *  spawn attempt via `resolveDrvPath` (so a host whose nix-system changes
 *  is picked up on the next reconnect), and a single host should map to a
 *  single session regardless of which derivation a given resolve yields.
 *
 *  First call wins: once a `(host, binary)` session exists, later calls
 *  return it and ignore their `opts` entirely — including a different
 *  `resolveDrvPath`. A second caller wanting a different resolver for the
 *  same host/binary is a key collision, not a new session; resolve the
 *  conflict at the call site (one resolver per host/binary) rather than
 *  expecting the pool to honour the second one.
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
  const key = `${opts.host}::${opts.binary}`;
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
