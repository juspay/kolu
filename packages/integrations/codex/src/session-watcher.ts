/**
 * CodexWatcher — per-session lifecycle over the supplied executor.
 *
 * On each WAL event, re-read mutable SQLite metadata through
 * `executor.queryDb`, tail the rollout JSONL through `executor.exec`, and
 * publish a changed CodexInfo snapshot.
 */

import { agentInfoEqual } from "anyagent";
import type { Executor } from "kolu-io";
import type { Logger } from "kolu-shared";
import {
  type CodexSession,
  getThreadMetadata,
  parseRolloutContextTokens,
  parseRolloutState,
} from "./core.ts";
import type { CodexInfo } from "./schemas.ts";

const WAL_DEBOUNCE_MS = 150;
const TAIL_BYTES = 256 * 1024;

export interface CodexWatcher {
  readonly session: CodexSession;
  destroy(): void;
}

export function createCodexWatcher(
  session: CodexSession,
  executor: Executor,
  onChange: (info: CodexInfo) => void,
  log?: Logger,
): CodexWatcher {
  let lastInfo: CodexInfo | null = null;
  let cachedDerive: {
    size: number;
    state: CodexInfo["state"];
    contextTokens: number | null;
  } | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchHandle: { stop(): void } | null = null;
  let refreshInFlight = false;
  let refreshPending = false;

  async function refresh(): Promise<void> {
    if (stopped) return;
    if (refreshInFlight) {
      refreshPending = true;
      return;
    }
    refreshInFlight = true;
    try {
      const info = await readInfo();
      if (stopped || info === null) return;
      if (agentInfoEqual(info, lastInfo)) return;
      log?.debug(
        {
          state: info.state,
          model: info.model,
          session: info.sessionId,
          tokens: info.contextTokens,
        },
        "codex state updated",
      );
      lastInfo = info;
      onChange(info);
    } finally {
      refreshInFlight = false;
      if (refreshPending && !stopped) {
        refreshPending = false;
        setTimeout(() => void refresh(), 0);
      }
    }
  }

  async function readInfo(): Promise<CodexInfo | null> {
    const meta = await getThreadMetadata(
      session.id,
      executor,
      session.dbPath,
      log,
    );
    if (!meta) {
      log?.warn(
        { session: session.id },
        "codex thread row disappeared after match",
      );
      return null;
    }

    const size = await fileSizeBytes(session.rolloutPath, executor, log);
    if (size === null) return null;

    let state: CodexInfo["state"];
    let contextTokens: number | null;
    if (cachedDerive !== null && cachedDerive.size === size) {
      state = cachedDerive.state;
      contextTokens = cachedDerive.contextTokens;
    } else {
      const lines = await tailLines(
        session.rolloutPath,
        TAIL_BYTES,
        executor,
        log,
      );
      const parsedState = parseRolloutState(lines);
      if (parsedState === null) {
        log?.debug(
          { session: session.id, path: session.rolloutPath },
          "codex rollout has no task events yet",
        );
        return null;
      }
      state = parsedState;
      contextTokens = parseRolloutContextTokens(lines);
      cachedDerive = { size, state, contextTokens };
    }

    return {
      kind: "codex",
      state,
      sessionId: session.id,
      model: meta.model,
      summary: meta.title,
      taskProgress: null,
      contextTokens,
    };
  }

  function scheduleRefresh(): void {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, WAL_DEBOUNCE_MS);
  }

  void executor
    .watch(session.walPath, scheduleRefresh, { recursive: false })
    .then((handle) => {
      if (stopped) handle.stop();
      else watchHandle = handle;
    })
    .catch((err) =>
      log?.debug({ err, path: session.walPath }, "codex WAL watch failed"),
    );
  void refresh();

  return {
    session,
    destroy(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      watchHandle?.stop();
      watchHandle = null;
    },
  };
}

async function fileSizeBytes(
  filePath: string,
  executor: Executor,
  log?: Logger,
): Promise<number | null> {
  try {
    const result = await executor.exec("wc", ["-c", filePath], {
      timeoutMs: 10_000,
      maxBytes: 4096,
    });
    if (result.exitCode !== 0) {
      log?.debug(
        { stderr: result.stderr, filePath },
        "codex rollout stat failed",
      );
      return null;
    }
    const sizeText = /^\s*(\d+)/.exec(result.stdout)?.[1];
    return sizeText ? Number.parseInt(sizeText, 10) : null;
  } catch (err) {
    log?.debug({ err, filePath }, "codex rollout stat threw");
    return null;
  }
}

async function tailLines(
  filePath: string,
  bytes: number,
  executor: Executor,
  log?: Logger,
): Promise<string[]> {
  try {
    const result = await executor.exec(
      "tail",
      ["-c", String(bytes), filePath],
      {
        timeoutMs: 10_000,
        maxBytes: bytes + 4096,
      },
    );
    if (result.exitCode !== 0) {
      log?.debug(
        { stderr: result.stderr, filePath },
        "codex rollout read failed",
      );
      return [];
    }
    const startsAtFileBeginning =
      Buffer.byteLength(result.stdout, "utf8") < bytes;
    return result.stdout
      .split("\n")
      .slice(startsAtFileBeginning ? 0 : 1)
      .filter((line) => line.length > 0);
  } catch (err) {
    log?.debug({ err, filePath }, "codex rollout read threw");
    return [];
  }
}
