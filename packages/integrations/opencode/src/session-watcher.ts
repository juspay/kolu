/**
 * OpenCodeWatcher — encapsulates all per-session lifecycle state.
 *
 * Lifecycle:
 *   1. Open an `executor.watch` on the OpenCode WAL file. Either the
 *      controller's local `fs.watch` (local terminals) or a helper-side
 *      `fs.watch` that pushes events back over SSH (remote terminals) —
 *      same callback, two backends.
 *   2. Debounce the WAL-change burst (OpenCode streams parts during
 *      generation, fs.watch fires multiple events per write).
 *   3. On each debounced tick: re-read the session's latest message +
 *      task progress + token count via `executor.queryDb`, derive the
 *      `OpenCodeInfo`, and emit it if it differs from the last one.
 *
 * No polling. The watcher is event-driven: a fresh PTY that hasn't
 * touched opencode pays zero RPC traffic.
 */

import { type AgentWatcher, agentInfoEqual, type Executor } from "anyagent";
import type { Logger } from "kolu-shared";
import {
  deriveSessionState,
  getLatestAssistantContextTokens,
  getSessionTaskProgress,
  getSessionTitle,
  type OpenCodeSession,
  runningToolsBucket,
} from "./core.ts";
import type { OpenCodeInfo } from "./schemas.ts";

/** Trailing-edge debounce for WAL change callbacks. OpenCode streams
 *  parts during generation, and fs.watch fires multiple events per write
 *  — without debouncing, `refresh` would run dozens of times per second
 *  during active use, each call running multiple SQL queries. 150 ms
 *  coalesces bursts into one handler run while keeping user-perceptible
 *  lag imperceptible. */
const WAL_DEBOUNCE_MS = 150;

export interface OpenCodeWatcher extends AgentWatcher {
  readonly session: OpenCodeSession;
}

/** Start watching an OpenCode session. Emits the initial state immediately,
 *  then re-emits on every WAL-change burst (debounced) when state differs.
 *
 *  `executor` is the IO seam: `localExecutor` for local terminals, the
 *  terminal's `Host` for remote ones. Both implement `watch` + `queryDb`,
 *  so the body below doesn't branch on backend. */
export function createOpenCodeWatcher(
  session: OpenCodeSession,
  executor: Executor,
  onChange: (info: OpenCodeInfo) => void,
  log?: Logger,
): OpenCodeWatcher {
  let last: OpenCodeInfo | null = null;
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let watchHandle: { stop(): void } | null = null;
  let pending = false;
  let inFlight = false;

  async function refresh(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      // A refresh is already running; mark a follow-up. The current run
      // will re-check the flag and re-fire if set.
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const derived = await deriveSessionState(
        session.id,
        session.dbPath,
        executor,
        log,
      );
      if (stopped) return;
      if (!derived) {
        log?.debug(
          { session: session.id },
          "no messages yet for opencode session",
        );
        return;
      }

      // Run the three follow-up reads in parallel — they're independent
      // queries against the same DB and each is dominated by IO latency.
      const [toolBucket, taskProgress, summary, contextTokens] =
        await Promise.all([
          derived.state === "thinking"
            ? runningToolsBucket(
                derived.messageId,
                session.dbPath,
                executor,
                log,
              )
            : Promise.resolve(null),
          getSessionTaskProgress(session.id, session.dbPath, executor, log),
          getSessionTitle(session.id, session.dbPath, executor, log),
          getLatestAssistantContextTokens(
            session.id,
            session.dbPath,
            executor,
            log,
          ),
        ]);
      if (stopped) return;

      const state =
        derived.state === "thinking"
          ? (toolBucket ?? derived.state)
          : derived.state;

      const info: OpenCodeInfo = {
        kind: "opencode",
        state,
        sessionId: session.id,
        model: derived.model,
        summary: summary ?? session.title,
        taskProgress,
        contextTokens,
      };
      if (agentInfoEqual(info, last)) return;
      last = info;
      log?.debug(
        { state: info.state, model: info.model, session: info.sessionId },
        "opencode state updated",
      );
      onChange(info);
    } catch (err) {
      log?.debug({ err, session: session.id }, "opencode refresh failed");
    } finally {
      inFlight = false;
      if (pending && !stopped) {
        pending = false;
        // Schedule the follow-up off the microtask queue so we don't grow
        // the call stack arbitrarily during a burst.
        setTimeout(() => void refresh(), 0);
      }
    }
  }

  function scheduleRefresh(): void {
    if (stopped) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void refresh();
    }, WAL_DEBOUNCE_MS);
  }

  // WAL path is colocated with the DB. SQLite WAL mode names it
  // "<dbPath>-wal"; we watch that file directly. On disk the WAL may
  // not exist until OpenCode's first write, so wrap the install in a
  // try/catch — if the watcher install fails we fall back to a direct
  // refresh and rely on the next title/cwd reconcile to re-attempt.
  void (async () => {
    try {
      watchHandle = await executor.watch(
        `${session.dbPath}-wal`,
        () => scheduleRefresh(),
        { recursive: false },
      );
    } catch (err) {
      log?.debug(
        { err, walPath: `${session.dbPath}-wal` },
        "opencode WAL watch install failed; using initial refresh only",
      );
    }
    void refresh();
  })();

  return {
    session,
    destroy: () => {
      stopped = true;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      watchHandle?.stop();
      watchHandle = null;
    },
  };
}
