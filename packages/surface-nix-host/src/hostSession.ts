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
 *     disconnected ──gave up (N *remote* fails)──▶ failed   (terminal; `reconnect()` re-arms)
 *
 * New listeners attached via `onState` see the *current* state
 * synchronously before any deltas arrive — matching the snapshot-then-
 * delta contract `@kolu/surface`'s `useCell` consumers expect.
 *
 * When the link dies (the agent process exits, ssh drops), the session
 * clears the stdio client and respawns after an exponentially-backed-
 * off delay, capped at 60 s. Whether the loop ever *gives up* depends on
 * the failure's `FailureCause` (see that type):
 *
 *   - `"remote"` (reached the host, it rejected us — e.g. `trusted-users`
 *     doesn't grant the parent's user) is terminal after
 *     `MAX_CONSECUTIVE_FAILURES`: retrying can't fix a misconfiguration,
 *     so it fails loudly into `failed` instead of spinning forever.
 *   - `"network"` (couldn't reach the host at all — asleep, roaming
 *     between Wi-Fi networks, VPN down) is *never* terminal: it keeps
 *     retrying at the capped backoff indefinitely, so a laptop that
 *     closes its lid at home and reopens at a café self-heals the moment
 *     the host is reachable again, with no manual Reconnect.
 *
 * `recheck()` is the wake/network-change companion: unlike `reconnect()`
 * (which only re-arms a `failed`/idle session and won't disturb a live
 * link), it force-cycles even a *seemingly-connected* link whose socket
 * may have gone stale across a sleep — the parent can't otherwise tell a
 * live link from one the far end already dropped until ssh's keepalive
 * notices ~30 s later.
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
import { buildAgentCommand, type FailureCause, forEachLine } from "./host";
import { provisionAgent } from "./nixCopy";

// `FailureCause` lives in `./host` (shared with `provisionAgent`, which now
// decides it per provisioning step); re-export so existing importers of it
// from this module keep working.
export type { FailureCause };

export type ConnectionState =
  | "copying"
  | "connecting"
  | "connected"
  | "disconnected"
  // Terminal: the reconnect loop exhausted `MAX_CONSECUTIVE_FAILURES`
  // on a `"remote"` fault and stopped retrying. Distinct from
  // `disconnected` (the brief gap between attempts) so consumers can tell
  // "still trying" from "gave up — needs intervention". `reconnect()`
  // re-arms it. A `"network"` fault never reaches this state.
  | "failed";

export interface HostSessionState {
  connection: ConnectionState;
  /** Free-form progress lines (last 20) — `nix copy` output, ssh
   *  start, agent fatal-error tails. */
  progressLines: readonly string[];
  /** Last error if `connection === "disconnected"` or `"failed"`. */
  lastError: string | null;
  /** Why the link is down — set alongside `disconnected`/`failed`, and
   *  `null` while `copying`/`connecting`/`connected`. Lets consumers say
   *  *why* a host is reconnecting ("host unreachable" vs "remote rejected
   *  the closure") rather than a single undifferentiated "reconnecting…".
   */
  failureCause: FailureCause | null;
}

export interface HostSessionOptions {
  host: string;
  /** Resolve the agent's `.drv` for this host. Called at the top of
   *  *every* spawn attempt (not once up front), so the round-trip that
   *  picks the derivation — typically an ssh `nix-instantiate` arch
   *  probe via `resolveSystem` — lives inside the session's own
   *  reconnect machinery. An unreachable host makes the resolver reject,
   *  which the session treats as a `"network"` fault: `disconnected` →
   *  backoff → `disconnected` → …, retrying indefinitely until the host is
   *  reachable again (never terminal — only a `"remote"` provisioning
   *  rejection gives up into `failed`). See `FailureCause`. The session
   *  ships the resolved derivation to the target host (no-op for localhost)
   *  and realises it there to get a target-arch-correct output path.
   *
   *  Pass a constant as `() => Promise.resolve(drv)` when the caller
   *  already knows the path and has no probe to defer. */
  resolveDrvPath: () => Promise<string>;
  /** Executable name inside the realised closure (e.g.
   *  `process-monitor-agent`, `kolu-terminal-agent`). The full spawn
   *  path is `${agentPath}/bin/${binary}`. */
  binary: string;
  /** Extra args appended after `--stdio` on the agent command line (e.g.
   *  `["--kaval", "<socket>"]` to point a remote `arivu --stdio` at a specific
   *  kaval). POSIX-quoted for a real remote; verbatim for localhost. See
   *  `buildAgentCommand`. */
  extraArgs?: readonly string[];
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
  /** Set by `recheck()` immediately before it kills a *live* child to
   *  re-probe after a wake/network change. The child's `exit` handler reads
   *  it to label that self-inflicted kill a `"network"` retry — otherwise a
   *  recheck during `connecting` (SIGTERM, no first RPC yet) would be
   *  classified `"remote"` and burn the bounded give-up budget on what is a
   *  transient recovery. Consumed (reset) in the exit handler. A class field
   *  rather than a spawn-local (like `connectTimedOut`) because `recheck()`
   *  lives outside the spawn closure. */
  private cyclingForRecheck = false;
  /** The session's observable state — current snapshot + delta stream
   *  in one. The framework's `inMemoryCell` owns the snapshot-then-
   *  delta contract, so this class doesn't hand-roll a listener set or
   *  a synchronous initial fire. */
  private readonly stateCell = inMemoryCell<HostSessionState>({
    connection: "copying",
    progressLines: [],
    lastError: null,
    failureCause: null,
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

  /** Assign and fire a new spawn, suppressing the rejection — spawn
   *  surfaces failure via state updates; the promise rejection is
   *  intentionally not propagated to callers. The three "fire and
   *  forget" spawn sites (reconnect, recheck, scheduleReconnect timer)
   *  all use this pattern. */
  private launchSpawn(): void {
    this.clientPromise = this.spawn();
    this.clientPromise.catch(() => {
      /* spawn surfaces failure via state; we just clear the promise */
    });
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
    this.updateState({
      connection: "copying",
      lastError: null,
      failureCause: null,
    });
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
      // Couldn't even resolve the .drv — the arch probe is an ssh
      // round-trip, so a rejection here means the host is unreachable:
      // a `"network"` fault, never terminal.
      this.updateState({
        connection: "disconnected",
        lastError: reason,
        failureCause: "network",
      });
      this.scheduleReconnect("network");
      throw err;
    });
    const provision = await provisionAgent({
      host: this.opts.host,
      drvPath,
      onProgress: (line) => this.addLocalProgress(line),
    });
    if (!provision.ok) {
      // Provisioning failed. `provisionAgent` tells us *why*: a `"remote"`
      // rejection (e.g. `trusted-users` won't accept the closure) is
      // terminal after the give-up gate — retrying can't fix it — but a
      // `"network"` failure (the host went unreachable mid-copy/realise,
      // after the arch probe had succeeded) keeps retrying like any other
      // transport fault. Without this, a sleep that lands between probe and
      // copy would still strand the host in `failed`.
      this.updateState({
        connection: "disconnected",
        lastError: provision.reason,
        failureCause: provision.cause,
      });
      this.scheduleReconnect(provision.cause);
      throw new Error(provision.reason);
    }
    const realisedAgentPath = provision.agentPath;

    this.updateState({ connection: "connecting" });
    const connectTimeoutMs = this.opts.connectTimeoutMs ?? 30_000;
    const { command, args } = buildAgentCommand({
      host: this.opts.host,
      agentPath: realisedAgentPath,
      binary: this.opts.binary,
      extraArgs: this.opts.extraArgs,
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

    const handleChildDone = (reason: string, cause: FailureCause): void => {
      this.addLocalProgress(reason);
      this.updateState({
        connection: "disconnected",
        lastError: reason,
        failureCause: cause,
      });
      this.child = null;
      this.clearClientPromise();
      if (!this.destroyed && this.refCount > 0) this.scheduleReconnect(cause);
    };

    child.on("exit", (code, signal) => {
      // Classify the exit by *phase*, not blanket `"network"`. A child that
      // exits before the first RPC because the agent binary is missing or
      // crashes on startup must NOT retry forever — only genuine transport
      // faults should. `wasConnected` is read before `handleChildDone`
      // transitions us off `connected`.
      const wasConnected = this.stateCell.current().connection === "connected";
      if (this.cyclingForRecheck) {
        // We killed this child ourselves to re-probe after a wake/network
        // change — a transient recovery, not a fault. Retry as `"network"`
        // so it never counts toward the bounded give-up budget, even if the
        // kill landed mid-`connecting` (SIGTERM, no first RPC).
        this.cyclingForRecheck = false;
        handleChildDone(
          "rechecking link after wake/network change — cycled ssh child",
          "network",
        );
        return;
      }
      if (connectTimedOut) {
        // Transport came up but the agent never answered the first RPC —
        // it's wedged, not unreachable. Bounded (`"remote"`) so a broken
        // startup fails loudly instead of spinning.
        handleChildDone(
          `connect handshake timed out after ${connectTimeoutMs}ms (transport up, no first RPC)`,
          "remote",
        );
        return;
      }
      const reason = `agent exited (code=${code}, signal=${signal})`;
      // A live link that dropped, or ssh's own connection failure (exit
      // 255), is transport — retry forever. A non-255 exit before we ever
      // connected means ssh ran the agent and *it* exited (bad path,
      // missing exe, startup crash) — bounded.
      const cause: FailureCause =
        wasConnected || code === 255 ? "network" : "remote";
      handleChildDone(reason, cause);
    });

    child.on("error", (err) => {
      // ssh (or the local exe) couldn't even be spawned — a local/config
      // problem that won't self-heal. Bounded.
      handleChildDone(`ssh failed to spawn: ${err.message}`, "remote");
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
    this.launchSpawn();
  }

  /** Re-probe the link after a host sleep or network change — the
   *  companion to the wake/`online` signals a long-running parent can
   *  observe. Where `reconnect()` deliberately won't disturb a live link
   *  (it's the manual "Reconnect" button, only meaningful from `failed`),
   *  `recheck()` force-cycles whatever is there, because a wake is exactly
   *  the case where a `connected` link is *lying*: the laptop slept, the
   *  far end dropped the TCP socket, but the local ssh child won't notice
   *  until its keepalive fails ~30 s later. Rather than wait, we cycle the
   *  child now and let the reconnect loop re-establish.
   *
   *  Resets the failure gate (a wake earns a fresh budget) and clears any
   *  pending backoff (retry *now*, not after the remaining wait). Then:
   *
   *   - live child → `kill` it; the existing `exit` handler routes through
   *     `handleChildDone` → `scheduleReconnect`, which nulls `clientPromise`
   *     and re-arms. We must NOT also spawn here, or we'd stack two spawns
   *     onto one session.
   *   - no child (failed / idle / mid-backoff) → spawn immediately, like
   *     `reconnect()` but without its "don't touch a live link" stance.
   *     here we cancel the backoff timer and respawn immediately, dropping
   *     the stale handle so the spawn isn't blocked.
   *
   *  No-op if destroyed or unreferenced. Safe to call on every host on
   *  each wake — a healthy host simply blips through one fast reconnect. */
  recheck(): void {
    if (this.destroyed || this.refCount === 0) return;
    this.consecutiveFailures = 0;
    if (this.child !== null) {
      // A live (connecting/connected) child whose socket may be stale after
      // a sleep. Clear the connect-watchdog and cycle it; `cyclingForRecheck`
      // tells the exit handler to schedule a `"network"` retry (a wake cycle
      // is recovery, never a budget-consuming fault — even mid-`connecting`).
      this.clearTimer();
      this.cyclingForRecheck = true;
      this.child.kill("SIGTERM");
      return;
    }
    if (this.pendingTimer !== null) {
      // In backoff: a retry is scheduled and `clientPromise` holds the last
      // *rejected* spawn (kept non-null so `ensureSpawned` stays idempotent
      // during the wait — see `scheduleReconnect`). Cancel the wait, drop the
      // stale handle, and spawn now. This is the case the original `recheck()`
      // mishandled — clearing the timer then bailing on the non-null slot.
      this.clearTimer();
      this.clearClientPromise();
      this.launchSpawn();
      return;
    }
    // No child, no pending timer: either a spawn is genuinely in flight
    // (`copying`, `clientPromise` pending) — leave it to run, don't stack a
    // second — or the session is idle/`failed` (`clientPromise` null) — spawn.
    if (this.clientPromise !== null) return;
    this.launchSpawn();
  }

  private scheduleReconnect(cause: FailureCause): void {
    if (this.destroyed || this.pendingTimer !== null) return;
    // NOTE: we deliberately do NOT null `clientPromise` here. While the
    // backoff timer is armed, a stale (rejected) `clientPromise` is what
    // keeps `ensureSpawned()` idempotent — an `acquire()`/`pin()` during
    // backoff sees it non-null and won't start a *second*, concurrent spawn
    // racing the timer. (`recheck()` handles the "cancel the timer →
    // respawn now" case explicitly; it doesn't rely on this slot being
    // null.) The terminal give-up branch below clears it, since `failed`
    // has no pending timer to act as the guard.
    // Exponential backoff is keyed on attempts-so-far, not "this is
    // attempt N after the failure". The previous code post-incremented
    // and then subtracted one to compensate (`2 ** (count - 1)`), which
    // is correct but reads like two off-by-ones cancelling. Decouple:
    // compute the delay from the pre-increment count, then bump.
    // Sequence: 2s, 4s, 8s, 16s — capped at 60s.
    const attemptsSoFar = this.consecutiveFailures;
    this.consecutiveFailures += 1;
    // Only a `"remote"` fault is terminal: we reached the host and it
    // rejected us, so retrying past the gate just spins. A `"network"`
    // fault (unreachable host — asleep, roaming, VPN down) is never
    // terminal: the host will answer again once it's reachable, and the
    // capped backoff keeps probing for that moment without manual
    // intervention. This is the roaming-laptop fix — see `FailureCause`.
    if (
      cause === "remote" &&
      this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
    ) {
      this.addLocalProgress(
        `gave up after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — fix the underlying issue (often: remote nix-daemon needs your user in 'trusted-users' to accept unsigned closures), then reconnect`,
      );
      // Terminal state has no pending timer, so null the (rejected) handle
      // here — otherwise `reconnect()`'s `clientPromise !== null` guard would
      // see the stale slot and silently no-op, stranding a failed session
      // (the original "Reconnect does nothing" bug). See `clearClientPromise`.
      this.clearClientPromise();
      // Move off `disconnected` so consumers can distinguish "still retrying"
      // from "gave up"; `lastError` is preserved from the spawn-failure path.
      this.updateState({ connection: "failed" });
      return;
    }
    const baseDelay = this.opts.reconnectDelayMs ?? 2000;
    const delay = Math.min(baseDelay * 2 ** attemptsSoFar, 60_000);
    // A `"network"` retry has no ceiling to count toward, so don't show a
    // misleading "attempt 7/5" — report it as the open-ended probe it is.
    this.addLocalProgress(
      cause === "network"
        ? `host unreachable — retrying in ${delay}ms… (attempt ${this.consecutiveFailures})`
        : `reconnecting in ${delay}ms… (attempt ${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
    );
    this.armTimer(delay, () => {
      if (this.destroyed || this.refCount === 0) return;
      this.launchSpawn();
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
