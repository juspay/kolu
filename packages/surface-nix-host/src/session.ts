/**
 * `makeSession` — the reconnect-mirror SESSION appliance (S9).
 *
 * A **session** is a durable, supervised relationship to one remote surface: it
 * dials the far end, notices when the link dies, redials with exponential backoff,
 * gives up loudly after too many *remote* rejections, and hands `reServeSurface`'s
 * pump a fresh client per (re)bind. That reconnect/backoff/give-up/state-merge loop
 * is the ELECTRICITY — extracted ONCE here, transport-agnostic.
 *
 * The transport is a **connector**: a `connectOnce` plug the loop calls per (re)dial.
 * It owns everything transport-specific — provisioning, spawning, the byte channel,
 * the per-attempt liveness probe — and hands back one {@link Connection} (a live
 * `client`, a `closed` signal, an `isAlive` probe). The ssh transport is
 * {@link sshConnector}; kolu-server's local padi arm supplies an endpoint connector.
 * Two transports, one loop; `reServeSurface` can't tell them apart.
 *
 * Connection-state lifecycle (snapshot-then-delta on `onState`), identical to the
 * pre-S9 `HostSession`:
 *
 *     copying      ──connectOnce ok──────▶ connecting
 *     copying      ──connectOnce reject──▶ disconnected (backoff, then retry)
 *     connecting   ──markConnected ──────▶ connected
 *     connecting   ──watchdog timeout ───▶ disconnected (tear down, then retry)
 *     connected    ──link died ──────────▶ disconnected ──reconnect──▶ copying
 *     disconnected ──gave up (N *remote* fails)──▶ failed   (terminal; `reconnect()` re-arms)
 *
 * A `"remote"` failure (reached the host, it rejected us) is terminal after
 * `MAX_CONSECUTIVE_FAILURES`; a `"network"` failure (unreachable host) is NEVER
 * terminal — the capped backoff keeps probing so a roaming laptop self-heals. See
 * {@link FailureCause}. `recheck()` force-cycles even a seemingly-connected link
 * (wake/network change); `reconnect()` only re-arms a `failed`/idle session.
 *
 * Every server auto-answers the framework-reserved `system.identity` (see
 * `@kolu/surface/identity`), so `identity()` reports the bound server's contract
 * version / uptime / build off the live client — `null` only transiently before
 * the first successful connect, never null-forever.
 */

import {
  createHeartbeat,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
} from "@kolu/surface/heartbeat";
import {
  probeSurfaceIdentity,
  type ServedIdentity,
  type SurfaceIdentity,
} from "@kolu/surface/identity";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import { inMemoryCell } from "@kolu/surface/server";
import type { SurfaceClientLike } from "@kolu/surface/project";
import type { ConnectionState } from "./connection";
import type { FailureCause } from "./host";

// `ConnectionState` / `FailureCause` are single-sourced from `./connection` /
// `./host` (shared with the cell schema + `provisionAgent`); re-export so existing
// importers keep reading them from the session module.
export type { ConnectionState, FailureCause };

const MAX_PROGRESS_LINES = 20;
const MAX_CONSECUTIVE_FAILURES = 5;

/** The observable link state a session publishes (snapshot-then-delta on
 *  `onState`). Renamed from `HostSessionState` (S3/S10 — "Host" named the deleted
 *  class); the shape is unchanged so every reader (odu, drishti, kolu-server) keeps
 *  its field reads. */
export interface SessionState {
  connection: ConnectionState;
  /** Free-form progress lines (last 20) — provisioning output, transport start,
   *  agent fatal-error tails. Carries BOTH parent-side (`[local] …`) and forwarded
   *  remote-stderr (`[remote] …`) lines for a unified log; a consumer that needs
   *  only the remote ones reads `remoteProgressLines`. */
  progressLines: readonly string[];
  /** The forwarded remote-agent stderr lines (last 20), WITHOUT the `[remote] `
   *  tag — the agent's own output as it wrote it. */
  remoteProgressLines: readonly string[];
  /** Last error if `connection === "disconnected"` or `"failed"`. */
  lastError: string | null;
  /** Why the link is down — set alongside `disconnected`/`failed`, `null` while
   *  `copying`/`connecting`/`connected`. */
  failureCause: FailureCause | null;
}

/** The minimal session slot a fleet registry stores (S1): it only ever calls
 *  `destroy()` (add-rollback, remove, destroyAll), so the slot demands exactly
 *  that. `Session` satisfies it; a registry keyed on `DestroyableSession` never
 *  names a richer session type it doesn't use. Fleet verbs (reconnect/recheck) are
 *  declared separately via `buildHostRegistry`'s `controls` (S2). */
export interface DestroyableSession {
  destroy(): void;
}

/** The reconnect-mirror receptacle's SESSION role — everything `reServeSurface` /
 *  `pumpRemoteSurface` and the fleet registry consume. `makeSession` returns this;
 *  kolu-server's padi arms are this plus the daemon members (added by object
 *  spread). Parameterized by the CLIENT the transport yields (default the opaque
 *  `SurfaceClientLike` the mirror forwards structurally) — NOT by the contract, so a
 *  specific-contract session stays assignable to the general receptacle (the
 *  covariance `session.variance.test-d.ts` pins). */
export interface Session<Client = SurfaceClientLike> {
  /** Pin the session open for the parent's lifetime (bumps a ref so the reconnect
   *  loop keeps retrying across transient callers reaching zero). Resolves with the
   *  first client. */
  pin(): Promise<Client>;
  /** The in-flight/current client promise, or `null` between a link death and the
   *  next dial. Each dial reassigns it, so a pump detects a respawn by identity
   *  drift. */
  currentClient(): Promise<Client> | null;
  /** Has `destroy()` been called? */
  isDestroyed(): boolean;
  /** Snapshot-then-delta listener: fires the current state synchronously, then on
   *  every change. Returns an unsubscribe. */
  onState(cb: (s: SessionState) => void): () => void;
  /** Called by the consumer's router/pump after the first RPC roundtrips — the
   *  `connecting → connected` cue the loop can't infer generically. */
  markConnected(): void;
  /** Immediately drop the session regardless of ref count (server shutdown). */
  destroy(): void;
  /** Re-arm a session that gave up (`connection === "failed"`); no-op on a live
   *  link. The manual "Reconnect" trigger. Universal — every session reconnects. */
  reconnect(): void;
  /** Force a fresh link probe (wake / network change) — force-cycles even a
   *  seemingly-`connected` link whose socket may have gone stale across a sleep. */
  recheck(): void;
  /** The bound server's identity off its reserved `system.identity` — a TOTAL,
   *  null-free {@link SurfaceIdentity} sum. `disconnected` before the first successful
   *  connect / between dials; `anonymous`/`identified` once connected (never
   *  null-forever — every server answers `system.identity`). */
  identity(): SurfaceIdentity;
}

/** How a live connection ended — the RAW transport signal the loop classifies (it
 *  alone knows whether the link was `connected`, and whether it initiated the
 *  teardown). A process/link death carries the exit `code`/`signal`; a spawn error
 *  (the transport couldn't even start) carries a message and is always terminal-ish
 *  `"remote"` (a local/config fault). */
export type ClosedInfo =
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "spawn-error"; message: string };

/** A single live connection attempt, handed back by a connector once the transport
 *  is up (the `connecting` phase — client built, first RPC not yet seen). */
export interface Connection<Client> {
  /** The live client for THIS attempt. */
  client: Client;
  /** Resolves when THIS attempt's link dies. The loop awaits it to reconnect. */
  closed: Promise<ClosedInfo>;
  /** Probe THIS connection's liveness — the watchdog's per-transport probe. A
   *  rejection still counts as alive (the round-trip completed); only a true
   *  non-answer (timeout) is stale. Defaults to `system.live` for a plain client. */
  isAlive(): Promise<void>;
  /** Force-tear-down THIS connection (recheck / connect-timeout / destroy). Routes
   *  through `closed` — so the loop's reconnect/give-up machinery runs once. */
  teardown(): void;
}

/** The per-attempt context the loop hands a connector: emit progress + signal the
 *  transport is up. The loop owns the state cell; the connector only pushes lines
 *  and flips to `connecting`. */
export interface ConnectContext {
  /** Push a parent-side (`[local]`) progress line — provisioning output, spawn
   *  errors, transport start. */
  localProgress(line: string): void;
  /** Push a forwarded remote-agent (`[remote]`) stderr line. */
  remoteProgress(line: string): void;
  /** The transport is up and the client is built — move `copying → connecting`.
   *  Called by the connector before it returns the {@link Connection}. */
  connecting(): void;
}

/** A transport plug: dial ONCE and return a live {@link Connection}, or REJECT with
 *  a {@link ConnectError} classifying a provisioning/resolve failure (`network` =
 *  retry forever, `remote` = bounded → give up). The loop owns everything after. */
export type Connector<Client> = (
  ctx: ConnectContext,
) => Promise<Connection<Client>>;

/** A connector's rejection: a provisioning/resolve failure it classified itself
 *  (the connector knows the transport). A plain Error rejection is read as
 *  `"network"` (an unreachable-host default). */
export class ConnectError extends Error {
  constructor(
    message: string,
    // NB: NOT `cause` — that shadows the built-in `Error.cause`, which a strict
    // downstream tsconfig (drishti's `noImplicitOverride`) rejects (TS4115). This is
    // the connector's own transport classification, so it gets its own honest name,
    // matching `AdmitRefusal.failureCause`.
    readonly failureCause: FailureCause,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

/** The degraded frame a {@link Admit} `refuse` overlays onto the session state —
 *  the transport is up but the session won't serve this far end (a contract skew a
 *  binder won't speak). Merged into `onState`, so a refusal is a visible cell state,
 *  never a swallowed log line. */
export interface AdmitRefusal {
  lastError: string;
  failureCause: FailureCause;
}

/** An {@link Admit} hook's verdict on a connector's fresh connection — a CLOSED
 *  union (every outcome named; no boolean flags):
 *   - `adopt`         — the far end is who we want; use this connection (the admit
 *                        handshake proved the link live, so the session marks
 *                        connected without waiting for the consumer's first frame).
 *   - `refuse(state)` — reject it and OVERLAY `state` (a degraded frame) onto
 *                        `onState`; the transport stays up (a persistent skew doesn't
 *                        spin a reconnect loop), the client is withheld, and the loop
 *                        re-admits only if the link later dies on its own.
 *   - `replaced`      — this connection was replaced by the admit hook itself (a
 *                        supervisor drained the far end → it exits); reconnect brings
 *                        up the successor. */
export type AdmitVerdict =
  | { kind: "adopt" }
  | { kind: "refuse"; state: AdmitRefusal }
  | { kind: "replaced"; reason: string };

/** Admit (or reject) a connector's fresh connection before the session adopts it —
 *  the SUPERVISION seam a daemon session plugs its convergence into (padi's
 *  control-core hello + skew/build decision + drain enactment). Runs once per dial,
 *  after the transport is up (the client is live). Omitted → every connection is
 *  adopted (the plain ssh/agent case). The hook may itself act on the far end (drain
 *  it) before returning `replaced`; a rejection FROM the hook is treated as a link
 *  failure (the handshake RPC died mid-flight) → reconnect. */
export type Admit<Client> = (client: Client) => Promise<AdmitVerdict>;

export interface MakeSessionOptions<Client> {
  /** The transport plug — dial once, hand back a live {@link Connection}. */
  connectOnce: Connector<Client>;
  /** Optional SUPERVISION hook run once per dial after the transport is up — a
   *  daemon session's convergence (padi: control-core hello + skew/build decision +
   *  drain). Omit for a plain session (every connection adopted). See {@link Admit}. */
  admit?: Admit<Client>;
  /** Delay between disconnect and the first reconnect attempt (exponential from
   *  here, capped at 60s). Default 2s. */
  reconnectDelayMs?: number;
  /** How long to wait for `markConnected` after the transport comes up before
   *  treating `connecting` as wedged and tearing the connection down (routes
   *  through the normal reconnect path). Default 30s. */
  connectTimeoutMs?: number;
  /** Disable the periodic liveness watchdog (default ON). While `connected`, the
   *  watchdog races the connection's `isAlive` probe against a timeout; a true
   *  non-answer force-cycles the link (a silently half-open socket). An object
   *  tunes the cadence — so the illegal "tune a disabled watchdog" state is
   *  unrepresentable. */
  liveness?: false | { intervalMs?: number; timeoutMs?: number };
  /** Where the session's diagnostic lines go — default `process.stderr`. An
   *  alt-screen consumer passes its own sink so lines never corrupt the render. */
  onLog?: (line: string) => void;
  /** Label for diagnostic lines (`[<label>] …`) — e.g. the host. Default `session`. */
  label?: string;
}

/**
 * Build a reconnect-mirror session over a transport connector. Owns the whole
 * durable lifecycle: pin/ref-count, backoff + give-up, the connect watchdog, the
 * liveness watchdog, `recheck`/`reconnect`, the state cell, and the `system.identity`
 * poll. Returns the {@link Session} role — a plain object (closures), so a daemon
 * flavor is derived by spreading supervision members onto it (no wrapper class).
 */
export function makeSession<Client = SurfaceClientLike>(
  opts: MakeSessionOptions<Client>,
): Session<Client> {
  const label = opts.label ?? "session";
  const reconnectDelayMs = opts.reconnectDelayMs ?? 2000;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 30_000;

  let refCount = 0;
  let destroyed = false;
  let consecutiveFailures = 0;
  /** The single pending phase-transition timer — either the reconnect-backoff delay
   *  (armed in `disconnected`) or the connect watchdog (armed in `connecting`). The
   *  two are never live at once, so folding them into one slot makes "at most one
   *  timer pending" a structural invariant. */
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** The in-flight/current client promise (or `null` between a link death and the
   *  backoff timer firing). Each dial reassigns it, so the pump's cursor advances on
   *  identity. */
  let clientPromise: Promise<Client> | null = null;
  /** The live connection handle for the current spawn (its `teardown` + `isAlive`),
   *  or `null` when no link is up. */
  let current: Connection<Client> | null = null;
  /** Set by `recheck()` before it tears down a live connection, so the closed
   *  handler labels that self-inflicted teardown a `"network"` retry (recovery, not
   *  a budget-consuming fault). Consumed in the closed handler. */
  let cyclingForRecheck = false;
  /** Set by the connect watchdog when it tears down a wedged `connecting`, so the
   *  closed handler reports a bounded `"remote"` timeout (a broken handshake fails
   *  loudly instead of spinning). */
  let connectTimedOut = false;
  /** The periodic liveness watchdog handle (ONE `@kolu/surface/heartbeat`), or
   *  `null` until first connect / after teardown. */
  let liveness: { dispose: () => void } | null = null;
  /** The bound server's served identity off its `system.identity`, or `null` before
   *  the first successful poll / after a link death (re-polled on the next connect,
   *  so a respawned server's fresh identity lands). `null` here is the INTERNAL
   *  "not-yet-polled" state; the public `identity()` maps it to the `disconnected`
   *  arm of the null-free {@link SurfaceIdentity} sum. */
  let cachedIdentity: ServedIdentity | null = null;

  const stateCell = inMemoryCell<SessionState>({
    connection: "copying",
    progressLines: [],
    remoteProgressLines: [],
    lastError: null,
    failureCause: null,
  });

  const emit = (line: string): void => {
    if (opts.onLog) {
      try {
        opts.onLog(line);
      } catch (err) {
        // A throwing sink must not escape the diagnostic funnel and freeze the
        // session; surface the sink's own failure on stderr so it isn't swallowed.
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[${label}] onLog sink threw: ${reason}\n`);
      }
    } else {
      process.stderr.write(`${line}\n`);
    }
  };

  const clearTimer = (): void => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const armTimer = (delayMs: number, fn: () => void): void => {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      fn();
    }, delayMs);
  };

  const logTransition = (from: ConnectionState, to: ConnectionState): void => {
    if (from !== to) emit(`[${label} local] connection: ${from} → ${to}`);
  };

  const updateState = (patch: Partial<SessionState>): void => {
    const prev = stateCell.current();
    const next: SessionState = { ...prev, ...patch };
    if (patch.progressLines !== undefined) {
      next.progressLines = patch.progressLines.slice(-MAX_PROGRESS_LINES);
    }
    if (patch.remoteProgressLines !== undefined) {
      next.remoteProgressLines = patch.remoteProgressLines.slice(
        -MAX_PROGRESS_LINES,
      );
    }
    if (patch.connection !== undefined) {
      logTransition(prev.connection, patch.connection);
      // Leaving `connecting` by any path disarms the connect watchdog — one
      // choke-point, so the closed/markConnected paths don't each clear it.
      if (prev.connection === "connecting" && patch.connection !== "connecting")
        clearTimer();
    }
    if (patch.lastError != null)
      emit(`[${label}] lastError: ${patch.lastError}`);
    stateCell.set(next);
  };

  const localProgress = (line: string): void => {
    emit(`[${label} local] ${line}`);
    updateState({
      progressLines: [...stateCell.current().progressLines, `[local] ${line}`],
    });
  };

  const remoteProgress = (line: string): void => {
    emit(`[${label} remote] ${line}`);
    const cur = stateCell.current();
    updateState({
      progressLines: [...cur.progressLines, `[remote] ${line}`],
      remoteProgressLines: [...cur.remoteProgressLines, line],
    });
  };

  const startLiveness = (): void => {
    if (opts.liveness === false || liveness !== null) return;
    const tuning = typeof opts.liveness === "object" ? opts.liveness : {};
    liveness = createHeartbeat({
      intervalMs: tuning.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      timeoutMs: tuning.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      isLive: () =>
        !destroyed &&
        stateCell.current().connection === "connected" &&
        current !== null,
      probe: () => {
        const conn = current;
        if (conn === null) return Promise.reject(new Error("no connection"));
        return conn.isAlive();
      },
      onStale: () => {
        if (destroyed) return;
        localProgress(
          "liveness probe timed out — remote wedged, force-cycling the link",
        );
        session.recheck();
      },
    });
  };

  const stopLiveness = (): void => {
    if (liveness !== null) {
      liveness.dispose();
      liveness = null;
    }
  };

  const scheduleReconnect = (cause: FailureCause): void => {
    if (destroyed || pendingTimer !== null) return;
    // A stale (rejected) `clientPromise` during backoff keeps `launchAttempt`
    // idempotent — an acquire/pin during the wait won't start a second concurrent
    // dial. The terminal give-up branch clears it (no timer to act as the guard).
    const attemptsSoFar = consecutiveFailures;
    consecutiveFailures += 1;
    if (cause === "remote" && consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      localProgress(
        `gave up after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — fix the underlying issue (often: remote nix-daemon needs your user in 'trusted-users' to accept unsigned closures), then reconnect`,
      );
      clientPromise = null;
      updateState({ connection: "failed" });
      return;
    }
    const delay = Math.min(reconnectDelayMs * 2 ** attemptsSoFar, 60_000);
    localProgress(
      cause === "network"
        ? `host unreachable — retrying in ${delay}ms… (attempt ${consecutiveFailures})`
        : `reconnecting in ${delay}ms… (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
    );
    armTimer(delay, () => {
      if (destroyed || refCount === 0) return;
      launchAttempt();
    });
  };

  const handleClosed = (conn: Connection<Client>, info: ClosedInfo): void => {
    // Stale close from a connection we already replaced/tore down — ignore.
    if (conn !== current) return;
    current = null;
    const wasConnected = stateCell.current().connection === "connected";
    let reason: string;
    let cause: FailureCause;
    if (cyclingForRecheck) {
      // We tore this down ourselves to re-probe after a wake/network change — a
      // transient recovery, retry as `"network"` so it never counts toward the
      // bounded give-up budget (even mid-`connecting`).
      cyclingForRecheck = false;
      reason = "rechecking link after wake/network change — cycled the link";
      cause = "network";
    } else if (connectTimedOut) {
      // Transport came up but the agent never answered the first RPC — wedged, not
      // unreachable. Bounded (`"remote"`) so a broken startup fails loudly.
      connectTimedOut = false;
      reason = `connect handshake timed out after ${connectTimeoutMs}ms (transport up, no first RPC)`;
      cause = "remote";
    } else if (info.kind === "spawn-error") {
      // The transport couldn't even start — a local/config problem. Bounded.
      reason = `transport failed to spawn: ${info.message}`;
      cause = "remote";
    } else {
      reason = `agent exited (code=${info.code}, signal=${info.signal})`;
      // A live link that dropped, or the transport's own connection failure
      // (exit 255), is transport — retry forever. A non-255 exit BEFORE we ever
      // connected means the transport ran the agent and IT exited (bad path,
      // missing exe, startup crash) — bounded.
      cause = wasConnected || info.code === 255 ? "network" : "remote";
    }
    localProgress(reason);
    updateState({
      connection: "disconnected",
      lastError: reason,
      failureCause: cause,
    });
    clientPromise = null;
    // The link is down — identity() must report `disconnected`, and the next
    // connect re-polls (a respawned server may be a different build).
    cachedIdentity = null;
    if (!destroyed && refCount > 0) scheduleReconnect(cause);
  };

  const attempt = async (): Promise<Client> => {
    updateState({ connection: "copying", lastError: null, failureCause: null });
    let conn: Connection<Client>;
    try {
      conn = await opts.connectOnce({
        localProgress,
        remoteProgress,
        connecting: () => updateState({ connection: "connecting" }),
      });
    } catch (err) {
      const cause: FailureCause =
        err instanceof ConnectError ? err.failureCause : "network";
      const reason = err instanceof Error ? err.message : String(err);
      updateState({
        connection: "disconnected",
        lastError: reason,
        failureCause: cause,
      });
      scheduleReconnect(cause);
      throw err instanceof Error ? err : new Error(reason);
    }
    // Wire this connection's death once, up front, so every path below (adopt /
    // refuse) routes a later link drop through the same reconnect machinery.
    const wireClosed = (): void => {
      conn.closed
        .then((info) => handleClosed(conn, info))
        .catch(() => {
          /* `closed` never rejects — the handler owns the outcome */
        });
    };

    // Supervision gate (S9): a daemon session ADMITS the fresh connection — padi's
    // control-core hello + skew/build convergence. No admit → adopt every connection.
    if (opts.admit !== undefined) {
      let verdict: AdmitVerdict;
      try {
        verdict = await opts.admit(conn.client);
      } catch (err) {
        // The admit handshake RPC itself died (a link blip mid-hello). Treat as a
        // link failure and reconnect (`network` — recovery, never a give-up spiral).
        const reason = err instanceof Error ? err.message : String(err);
        conn.teardown();
        updateState({
          connection: "disconnected",
          lastError: reason,
          failureCause: "network",
        });
        scheduleReconnect("network");
        throw err instanceof Error ? err : new Error(reason);
      }
      if (verdict.kind === "refuse") {
        // The transport is up but we won't serve this far end (a skew). KEEP the
        // connection (a later death re-admits), OVERLAY the degraded frame onto
        // `onState`, WITHHOLD the client (the cursor waits on the rejected promise),
        // and DON'T reconnect — a persistent skew holds degraded, it doesn't spin.
        // Reset the give-up budget: the hello proved the transport, this is not a
        // failure spiral. (Dissolves the old wrapper's separate state-overlay.)
        current = conn;
        wireClosed();
        consecutiveFailures = 0;
        updateState({
          connection: "disconnected",
          lastError: verdict.state.lastError,
          failureCause: verdict.state.failureCause,
        });
        throw new Error(verdict.state.lastError);
      }
      if (verdict.kind === "replaced") {
        // The admit hook drained the far end (it exits); tear the old link down and
        // reconnect to bring up the successor (`network` — a converge, not a fault).
        // The admit hello proved the transport live, so reset the give-up budget —
        // a bounded drain→respawn treadmill (fenced by the arm) must not grow the
        // backoff toward give-up, matching the pre-S9 markConnected-before-drain.
        consecutiveFailures = 0;
        conn.teardown();
        updateState({
          connection: "disconnected",
          lastError: verdict.reason,
          failureCause: "network",
        });
        scheduleReconnect("network");
        throw new Error(verdict.reason);
      }
      // adopt: the hello proved the link live. Take the connection, wire its death,
      // and mark connected NOW — no connect-watchdog needed (the link is proven), and
      // the consumer's later `markConnected` is a harmless no-op.
      current = conn;
      wireClosed();
      session.markConnected();
      return conn.client;
    }

    current = conn;
    // Defer `connected` until the first RPC roundtrips — the consumer signals that
    // via `markConnected()`; the connector's client has no synchronous "open".
    wireClosed();
    // Connect watchdog: transport up, but the first RPC may never roundtrip
    // (handshake wedges, process never exits). `markConnected`/`closed` are the only
    // other exits from `connecting`; without this the session hangs there forever.
    armTimer(connectTimeoutMs, () => {
      if (stateCell.current().connection !== "connecting") return;
      connectTimedOut = true;
      current?.teardown();
    });
    return conn.client;
  };

  const launchAttempt = (): void => {
    clientPromise = attempt();
    clientPromise.catch(() => {
      /* failure surfaces via the state cell; we just clear the promise */
    });
  };

  const ensureSpawned = (): Promise<Client> => {
    if (clientPromise === null) clientPromise = attempt();
    return clientPromise;
  };

  const pollIdentity = (client: Client): void => {
    // Poll the reserved `system.identity` off the fresh client (like the liveness
    // probe reads `system.live`). A rejection (an older server, a link blip) leaves
    // the last-known identity in place — an honest degrade, never a fabricated one.
    probeSurfaceIdentity(client)
      .then((id) => {
        if (destroyed) return;
        cachedIdentity = id;
        // The identity probe resolves on its OWN clock — a separate RPC fired from
        // `markConnected`, decoupled from the `connected` frame that was already
        // published (which sampled the pre-probe `disconnected` identity). Republish
        // the current state (no field change) to wake `onState` listeners, so a
        // consumer that derives PUBLISHED state from `identity()` inside `onState`
        // (kolu-server's padi uptime / surface version / build commit) resamples the
        // now-`identified` value. Without this, that readout would stay stale until an
        // unrelated transition. The pre-S9 binding set identity SYNCHRONOUSLY on the
        // `connected` frame (its `onState` fired with identity already in hand), so
        // this restores that parity across the async-probe boundary.
        stateCell.set({ ...stateCell.current() });
      })
      .catch(() => {
        /* no identity this cycle — keep the last-known; never fabricate one */
      });
  };

  const session: Session<Client> = {
    pin() {
      refCount += 1;
      const p = ensureSpawned();
      return p;
    },
    currentClient() {
      return destroyed ? null : clientPromise;
    },
    isDestroyed() {
      return destroyed;
    },
    onState(cb) {
      return stateCell.consume({
        onEvent: cb,
        onError: () => {
          /* the cell never errors — onError is required by Channel<T> shape */
        },
      });
    },
    markConnected() {
      if (stateCell.current().connection !== "connecting") return;
      consecutiveFailures = 0;
      updateState({ connection: "connected" });
      // Birth the liveness watchdog at the FIRST successful connect (so it can never
      // probe before the first RPC), and poll the server's identity off the fresh
      // client. Both idempotent across later reconnects.
      startLiveness();
      const p = clientPromise;
      if (p !== null) {
        // Clear a stale identity so a respawned server's fresh one lands (never a
        // stale mix from the old process); re-poll off the current client.
        cachedIdentity = null;
        p.then((client) => pollIdentity(client)).catch(() => {});
      }
    },
    destroy() {
      destroyed = true;
      clearTimer();
      stopLiveness();
      current?.teardown();
      current = null;
      clientPromise = null;
      cachedIdentity = null;
      // Re-publish (no field change) purely to wake `onState` listeners so a cursor
      // blocked on the next client observes `isDestroyed()` and unblocks (the F7 bug).
      stateCell.set({ ...stateCell.current() });
    },
    reconnect() {
      if (destroyed || refCount === 0) return;
      if (clientPromise !== null || pendingTimer !== null) return;
      consecutiveFailures = 0;
      launchAttempt();
    },
    recheck() {
      if (destroyed || refCount === 0) return;
      consecutiveFailures = 0;
      if (current !== null) {
        // A live (connecting/connected) link whose socket may be stale after a
        // sleep. Clear the connect-watchdog and cycle it; `cyclingForRecheck` tells
        // the closed handler to schedule a `"network"` retry (a wake cycle is
        // recovery, never a budget-consuming fault — even mid-`connecting`).
        clearTimer();
        cyclingForRecheck = true;
        current.teardown();
        return;
      }
      if (pendingTimer !== null) {
        // In backoff: cancel the wait, drop the stale (rejected) client handle, and
        // dial now.
        clearTimer();
        clientPromise = null;
        launchAttempt();
        return;
      }
      // No connection, no pending timer: either a dial is genuinely in flight
      // (`copying`, `clientPromise` pending) — leave it — or the session is
      // idle/`failed` (`clientPromise` null) — dial.
      if (clientPromise !== null) return;
      launchAttempt();
    },
    identity(): SurfaceIdentity {
      // TOTAL — never null. No live poll (destroyed, or between dials) is the
      // `disconnected` arm; a polled value is `anonymous`/`identified` verbatim.
      return destroyed || cachedIdentity === null
        ? { kind: "disconnected" }
        : cachedIdentity;
    },
  };

  return session;
}

/** The default `isAlive` probe for a plain surface client — the reserved
 *  `system.live` round-trip. A connector that yields a raw surface client uses this;
 *  a transport with its own liveness (an endpoint) supplies its own. */
export function surfaceLiveProbe(client: unknown): () => Promise<void> {
  return () => probeSurfaceLive(client).then(() => undefined);
}
