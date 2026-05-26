/**
 * HostSession — kolu-server's per-host RPC channel to the
 * `kolu-remote-agent` running on the remote host. Phase 2a of kolu#951.
 *
 * Owns:
 *   - The `ssh host node kolu-remote-agent/dist/index.js` subprocess
 *     and its stdio framing.
 *   - The request/response correlation map (id → resolver).
 *   - All active subscription tokens — so on reconnect the session can
 *     re-issue them transparently (closes hickey's "connection-lifecycle
 *     fragmentation" finding from the talk-mode review).
 *   - The state machine (Connecting / Connected / HeartbeatMissed(n) /
 *     Reconnecting / ReconnectFailed / ReconnectExhausted /
 *     ServerNotRunning), mirroring Zed's
 *     `/tmp/zed/crates/remote/src/remote_client.rs:157-185`.
 *
 * Consumers (Phase 2b's `RemoteXxxProvider` classes) only see the
 * narrow API: `.call(method, args)` and `.subscribe(method, args,
 * onEvent)`. The session re-issues subscriptions on reconnect; the
 * provider's `onEvent` callback fires continuously across drops.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";
import type { Logger } from "kolu-shared";
import {
  type RpcEvent,
  RpcFrameSchema,
  type RpcResponse,
} from "kolu-remote-agent/protocol";

// ── State machine ─────────────────────────────────────────────────────

export type ConnectionState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "heartbeatMissed"; missed: number }
  | { kind: "reconnecting"; attempts: number }
  | { kind: "reconnectFailed"; attempts: number; error: Error }
  | { kind: "reconnectExhausted" }
  | { kind: "serverNotRunning" };

/** Heartbeat constants — ported from Zed's
 *  `crates/remote/src/remote_client.rs:149-155`. */
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
const MAX_MISSED_HEARTBEATS = 5;
const MAX_RECONNECT_ATTEMPTS = 3;
const INITIAL_CONNECT_TIMEOUT_MS = 60_000;

// ── Subscription tokens ───────────────────────────────────────────────

/** Handle returned by `HostSession.subscribe`. Lifetime is the
 *  caller's; calling `close()` unregisters server-side. On reconnect
 *  the session re-issues the underlying subscription transparently —
 *  the same `onEvent` keeps firing. */
export interface SubscriptionToken<UpdateParams = unknown> {
  /** Mutate the subscription's args (e.g. `setCwd` for git info).
   *  No-op when the session is reconnecting; the new args are
   *  re-replayed on re-issue. */
  update(params: UpdateParams): Promise<void>;
  /** Tear down the subscription. Idempotent. */
  close(): Promise<void>;
}

interface ActiveSubscription {
  /** The integer id assigned by the remote agent for this stream. May
   *  change on reconnect — the session re-issues against the new
   *  agent process. */
  remoteId: number | null;
  method: string;
  args: unknown;
  onEvent: (payload: unknown) => void;
}

// ── HostSession ───────────────────────────────────────────────────────

export interface HostSessionOptions {
  /** SSH host alias from `~/.ssh/config` — passed as the destination
   *  argument to the `ssh` subprocess. */
  host: string;
  /** Absolute path on the remote to the agent binary. Resolved by
   *  `AgentBootstrap.ensureAgent(host)`. */
  remoteAgentPath: string;
  log: Logger;
}

export class HostSession {
  private readonly host: string;
  private readonly remoteAgentPath: string;
  private readonly log: Logger;

  private state: ConnectionState = { kind: "connecting" };
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: ReadlineInterface | null = null;
  private nextRequestId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  /** Local subscription token id → active subscription. The local id
   *  is stable across reconnects; the `remoteId` inside refreshes when
   *  the underlying subscription is re-issued. */
  private subscriptions = new Map<number, ActiveSubscription>();
  private nextLocalSubscriptionId = 1;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stateListeners = new Set<(s: ConnectionState) => void>();

  constructor(opts: HostSessionOptions) {
    this.host = opts.host;
    this.remoteAgentPath = opts.remoteAgentPath;
    this.log = opts.log;
  }

  /** Connect to the agent. Idempotent — calling again while already
   *  connected is a no-op. Throws on initial connect failure (caller
   *  surfaces this to the user via the DisconnectedOverlay). */
  async connect(): Promise<void> {
    if (this.state.kind === "connected") return;
    this.transitionTo({ kind: "connecting" });

    const child = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ServerAliveInterval=30",
        this.host,
        // Invoke the remote agent via node — same binary we ship; the
        // agent's `if (process.argv[1].endsWith(...))` guard boots it.
        "node",
        this.remoteAgentPath,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child = child;
    this.rl = createInterface({ input: child.stdout });

    this.rl.on("line", (line) => this.onLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.log.debug({ stderr: chunk.toString("utf-8") }, "agent stderr");
    });
    child.on("exit", (code, signal) => this.onChildExit(code, signal));

    // Probe with `version` before declaring connected — fails fast if
    // the agent binary is missing or the wrong version on the remote.
    const versionDeadline = Date.now() + INITIAL_CONNECT_TIMEOUT_MS;
    try {
      await this.callWithDeadline("version", null, versionDeadline);
    } catch (err) {
      this.log.error({ err }, "initial version probe failed");
      this.transitionTo({ kind: "serverNotRunning" });
      throw err;
    }

    this.transitionTo({ kind: "connected" });
    this.startHeartbeat();

    // Re-issue every active subscription after reconnect (no-op on
    // first connect — the map is empty). This is the load-bearing
    // piece hickey flagged: connection-lifecycle ownership lives here,
    // not in the per-domain providers.
    await this.reissueSubscriptions();
  }

  /** One-shot request. Throws on session failure or remote error. */
  async call(method: string, args: unknown): Promise<unknown> {
    if (this.state.kind !== "connected") {
      throw new Error(`HostSession not connected (state: ${this.state.kind})`);
    }
    return this.sendRequest(method, args);
  }

  /** Subscribe to a streaming method. Returns a `SubscriptionToken`
   *  the caller uses to update args (`setCwd` etc.) or close. The
   *  session owns the token's lifetime across reconnects. */
  subscribe<UpdateParams = unknown>(
    method: string,
    args: unknown,
    onEvent: (payload: unknown) => void,
  ): SubscriptionToken<UpdateParams> {
    const localId = this.nextLocalSubscriptionId++;
    const sub: ActiveSubscription = {
      remoteId: null,
      method,
      args,
      onEvent,
    };
    this.subscriptions.set(localId, sub);
    void this.issueSubscription(localId, sub);

    return {
      update: async (params: UpdateParams) => {
        sub.args = params;
        if (sub.remoteId !== null) {
          await this.sendRequest("subscription.update", {
            subscription: sub.remoteId,
            params,
          });
        }
      },
      close: async () => {
        if (sub.remoteId !== null) {
          await this.sendRequest("subscription.close", {
            subscription: sub.remoteId,
          }).catch(() => {
            // Best-effort: if the wire is already dead, the agent's
            // stdin-close handler will release the underlying watcher.
          });
        }
        this.subscriptions.delete(localId);
      },
    };
  }

  /** Subscribe to state-machine transitions. The DisconnectedOverlay
   *  in the client UI is driven by this through the WS streaming
   *  layer; the local server's UI overlay reads off the same signal. */
  onStateChange(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Read-only snapshot of the current state. */
  currentState(): ConnectionState {
    return this.state;
  }

  /** Tear down the session — kills the ssh subprocess, releases all
   *  pending requests + subscriptions. */
  async close(): Promise<void> {
    this.stopHeartbeat();
    for (const { reject } of this.pending.values()) {
      reject(new Error("HostSession closed"));
    }
    this.pending.clear();
    this.subscriptions.clear();
    if (this.child) {
      this.child.stdin.end();
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.rl?.close();
    this.rl = null;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private transitionTo(next: ConnectionState): void {
    this.state = next;
    this.log.info({ state: next.kind }, "host session state");
    for (const listener of this.stateListeners) {
      try {
        listener(next);
      } catch (err) {
        this.log.error({ err }, "state listener threw");
      }
    }
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    return this.callWithDeadline(
      method,
      params,
      Date.now() + HEARTBEAT_TIMEOUT_MS,
    );
  }

  private callWithDeadline(
    method: string,
    params: unknown,
    deadline: number,
  ): Promise<unknown> {
    if (!this.child) throw new Error("HostSession child not spawned");
    const id = this.nextRequestId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method} (id=${id})`));
        },
        Math.max(50, deadline - Date.now()),
      );
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      const frame = { kind: "request" as const, id, method, params };
      this.child?.stdin.write(`${JSON.stringify(frame)}\n`);
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      this.log.error({ err, line }, "invalid json from agent");
      return;
    }

    // Single-source dispatch through the protocol's discriminated
    // union — `RpcFrameSchema` validates kind + payload in one parse,
    // so adding a new frame variant lands in protocol.ts only.
    const frame = RpcFrameSchema.safeParse(parsed);
    if (!frame.success) {
      this.log.warn({ issues: frame.error.issues, line }, "invalid rpc frame");
      return;
    }
    if (frame.data.kind === "response") {
      this.onResponse(frame.data);
    } else if (frame.data.kind === "event") {
      this.onEvent(frame.data);
    }
    // `request` is never sent by the agent; if it appears we ignore.
  }

  private onResponse(resp: RpcResponse): void {
    const pending = this.pending.get(resp.id);
    if (!pending) return;
    this.pending.delete(resp.id);
    if (resp.error) {
      pending.reject(new Error(`${resp.error.code}: ${resp.error.message}`));
    } else {
      pending.resolve(resp.result);
    }
  }

  private onEvent(evt: RpcEvent): void {
    // Find which local subscription owns this remote id, then fire its
    // onEvent. O(n) scan acceptable at expected subscription counts;
    // upgrade to a reverse index if it ever bites.
    for (const sub of this.subscriptions.values()) {
      if (sub.remoteId === evt.subscription) {
        sub.onEvent(evt.payload);
        return;
      }
    }
  }

  private async issueSubscription(
    _localId: number,
    sub: ActiveSubscription,
  ): Promise<void> {
    try {
      const result = (await this.sendRequest(sub.method, sub.args)) as {
        subscription: number;
      };
      sub.remoteId = result.subscription;
    } catch (err) {
      this.log.error({ err, method: sub.method }, "subscription issue failed");
    }
  }

  private async reissueSubscriptions(): Promise<void> {
    for (const [localId, sub] of this.subscriptions) {
      sub.remoteId = null;
      await this.issueSubscription(localId, sub);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async heartbeat(): Promise<void> {
    if (
      this.state.kind !== "connected" &&
      this.state.kind !== "heartbeatMissed"
    ) {
      return;
    }
    try {
      await this.callWithDeadline(
        "ping",
        null,
        Date.now() + HEARTBEAT_TIMEOUT_MS,
      );
      if (this.state.kind === "heartbeatMissed") {
        this.transitionTo({ kind: "connected" });
      }
    } catch (err) {
      const missed =
        this.state.kind === "heartbeatMissed" ? this.state.missed + 1 : 1;
      // Per-miss visibility — without this the only signal is the
      // counter monotonically climbing, hiding any unexpected exception
      // (vs the expected timeout).
      this.log.debug({ err, missed }, "heartbeat ping failed");
      if (missed >= MAX_MISSED_HEARTBEATS) {
        this.log.warn(
          { missed },
          "heartbeat threshold exceeded — reconnecting",
        );
        this.stopHeartbeat();
        void this.reconnect(0);
      } else {
        this.transitionTo({ kind: "heartbeatMissed", missed });
      }
    }
  }

  private async reconnect(attempts: number): Promise<void> {
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      this.transitionTo({ kind: "reconnectExhausted" });
      return;
    }
    this.transitionTo({ kind: "reconnecting", attempts });
    try {
      await this.close();
      await this.connect();
    } catch (err) {
      this.transitionTo({
        kind: "reconnectFailed",
        attempts,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      // Exponential backoff: 1s, 2s, 4s.
      const delay = 2 ** attempts * 1000;
      setTimeout(() => void this.reconnect(attempts + 1), delay);
    }
  }

  private onChildExit(code: number | null, signal: string | null): void {
    this.log.warn({ code, signal }, "agent subprocess exited");
    this.stopHeartbeat();
    if (
      this.state.kind === "connected" ||
      this.state.kind === "heartbeatMissed"
    ) {
      void this.reconnect(0);
    }
  }
}
