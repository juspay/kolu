/**
 * OpenCode metadata provider — thin adapter that wires the
 * `kolu-opencode` integration library into the server's metadata system.
 *
 * All OpenCode-specific logic (REST client, SSE parsing, state derivation)
 * lives in `integrations/opencode`. This file owns the provider lifecycle:
 * subscribing to events, managing connection state, and calling
 * `updateMetadata`.
 *
 * Event-driven — no polling. Trigger sources:
 *   - title event (subscribeForTerminal("title", ...)) — fires on shell
 *     preexec/precmd OSC 2, which is when foregroundPid is likely to change
 *   - SSE stream from OpenCode's /event endpoint — fires on session status
 *     changes, delivers real-time state updates
 */

import { match } from "ts-pattern";
import type { OpenCodeInfo } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { infoEqual } from "./claude.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

import {
  healthCheck,
  listSessions,
  getSessionStatuses,
  deriveState,
  subscribeToEvents,
  type OpenCodeSession,
  type OpenCodeEvent,
} from "kolu-opencode";

// --- SSE connection lifecycle ---

/**
 * SSE connection state as a sum type — mutually exclusive states,
 * checked exhaustively via ts-pattern on every transition.
 */
type SseState =
  | { kind: "disconnected" }
  | { kind: "connected"; abort: AbortController; sessionId: string };

/**
 * Start the OpenCode metadata provider for a terminal entry.
 * Wakes on title events (foreground process change), then connects
 * to OpenCode's REST/SSE API when the foreground process is "opencode".
 */
export function startOpenCodeProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "opencode", terminal: terminalId });

  let sseState: SseState = { kind: "disconnected" };
  let lastSummary: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  plog.info("started");

  function teardownSse() {
    match(sseState)
      .with({ kind: "disconnected" }, () => {})
      .with({ kind: "connected" }, ({ abort }) => abort.abort())
      .exhaustive();
    sseState = { kind: "disconnected" };
  }

  /**
   * Called when the foreground process changes. If it's "opencode",
   * attempt to connect to the OpenCode API and discover the session.
   */
  async function onForegroundMaybeChanged() {
    const fg = entry.info.meta.foreground;
    const isOpenCode = fg?.name === "opencode";

    if (!isOpenCode) {
      if (sseState.kind !== "disconnected") {
        plog.info("opencode no longer foreground, disconnecting");
        teardownSse();
        if (entry.info.meta.agent?.kind === "opencode") {
          updateMetadata(entry, terminalId, (m) => {
            m.agent = null;
          });
        }
      }
      return;
    }

    // Already connected — nothing to do
    if (sseState.kind === "connected") return;

    // Try to connect to the OpenCode server
    const reachable = await healthCheck(undefined, plog);
    if (!reachable) {
      plog.debug({}, "opencode server not reachable");
      return;
    }

    // Discover session by CWD
    const cwd = entry.info.meta.cwd;
    const sessions = await listSessions(cwd, undefined, plog);
    if (sessions.length === 0) {
      plog.debug({ cwd }, "no opencode sessions for this directory");
      return;
    }

    // Prefer the busy session, fallback to the first one
    const statuses = await getSessionStatuses(undefined, plog);
    const busySession = sessions.find((s) => {
      const status = statuses.get(s.id);
      return status?.type === "busy";
    });
    const session = busySession ?? sessions[0]!;

    plog.info(
      { session: session.id, title: session.title, cwd },
      "opencode session matched",
    );

    lastSummary = session.title;

    // Derive initial state
    const status = statuses.get(session.id) ?? { type: "idle" as const };
    const initialState = deriveState(status);

    const info: OpenCodeInfo = {
      kind: "opencode",
      state: initialState,
      sessionId: session.id,
      model: null,
      summary: lastSummary,
    };

    updateMetadata(entry, terminalId, (m) => {
      m.agent = info;
    });

    // Start SSE subscription
    const abort = new AbortController();
    sseState = { kind: "connected", abort, sessionId: session.id };

    startSseSubscription(abort.signal, session);
  }

  function startSseSubscription(signal: AbortSignal, session: OpenCodeSession) {
    subscribeToEvents(signal, (event) => onSseEvent(event, session), plog)
      .then(() => {
        if (!signal.aborted) {
          plog.info("opencode SSE stream ended, scheduling reconnect");
          scheduleReconnect();
        }
      })
      .catch((err) => {
        if (!signal.aborted) {
          plog.debug({ err }, "opencode SSE subscription failed");
          scheduleReconnect();
        }
      });
  }

  function scheduleReconnect() {
    sseState = { kind: "disconnected" };
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (sseState.kind === "disconnected") {
        onForegroundMaybeChanged();
      }
    }, 5000);
  }

  function onSseEvent(event: OpenCodeEvent, session: OpenCodeSession) {
    if (sseState.kind !== "connected") return;

    match(event)
      .with({ type: "session.status" }, ({ properties }) => {
        if (properties.sessionID !== session.id) return;
        const newState = deriveState(properties.status);

        const info: OpenCodeInfo = {
          kind: "opencode",
          state: newState,
          sessionId: session.id,
          model: null,
          summary: lastSummary,
        };

        if (!infoEqual(entry.info.meta.agent, info)) {
          plog.info(
            { state: info.state, session: session.id },
            "opencode state updated",
          );
          updateMetadata(entry, terminalId, (m) => {
            m.agent = info;
          });
        }
      })
      .with({ type: "session.updated" }, ({ properties }) => {
        if (properties.id !== session.id) return;
        if (properties.title && properties.title !== lastSummary) {
          lastSummary = properties.title;
          const current = entry.info.meta.agent;
          if (current?.kind === "opencode") {
            plog.info(
              { title: lastSummary, session: session.id },
              "opencode summary updated",
            );
            updateMetadata(entry, terminalId, (m) => {
              m.agent = { ...current, summary: lastSummary };
            });
          }
        }
      })
      .with({ type: "heartbeat" }, () => {
        // No-op — heartbeats keep the connection alive
      })
      .with({ type: "unknown" }, () => {
        // Ignore unrecognized events
      })
      .exhaustive();
  }

  // Subscribe to title events — each shell preexec/precmd OSC 2 fires here.
  const titleAbort = new AbortController();
  subscribeForTerminal("title", terminalId, titleAbort.signal, () =>
    onForegroundMaybeChanged(),
  );

  // Initial check for a terminal that already hosts an opencode session.
  onForegroundMaybeChanged();

  return () => {
    titleAbort.abort();
    teardownSse();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    plog.info("stopped");
  };
}
