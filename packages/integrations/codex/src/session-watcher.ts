/**
 * CodexWatcher — per-session lifecycle over the supplied executor.
 *
 * On each shared WAL event, re-read mutable SQLite metadata through the
 * executor, tail the rollout JSONL, and publish a changed CodexInfo snapshot.
 */

import { agentInfoEqual } from "anyagent";
import type { Executor } from "kolu-io";
import type { Logger } from "kolu-shared";
import { createDebounceWatcher } from "kolu-shared/sqlite";
import {
  type CodexSession,
  getThreadMetadata,
  parseRolloutContextTokens,
  parseRolloutState,
} from "./core.ts";
import type { CodexInfo } from "./schemas.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";

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
  const watcherContext = { session, executor };
  let cachedDerive: {
    size: number;
    state: CodexInfo["state"];
    contextTokens: number | null;
  } | null = null;

  async function readInfo(
    ctx: typeof watcherContext,
  ): Promise<CodexInfo | null> {
    const meta = await getThreadMetadata(
      ctx.session.id,
      ctx.executor,
      ctx.session.dbPath,
      log,
    );
    if (!meta) {
      log?.warn(
        { session: ctx.session.id },
        "codex thread row disappeared after match",
      );
      return null;
    }

    const size = await fileSizeBytes(
      ctx.session.rolloutPath,
      ctx.executor,
      log,
    );
    if (size === null) return null;

    let state: CodexInfo["state"];
    let contextTokens: number | null;
    if (cachedDerive !== null && cachedDerive.size === size) {
      state = cachedDerive.state;
      contextTokens = cachedDerive.contextTokens;
    } else {
      const lines = await tailLines(
        ctx.session.rolloutPath,
        TAIL_BYTES,
        ctx.executor,
        log,
      );
      const parsedState = parseRolloutState(lines);
      if (parsedState === null) {
        log?.debug(
          { session: ctx.session.id, path: ctx.session.rolloutPath },
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
      sessionId: ctx.session.id,
      model: meta.model,
      summary: meta.title,
      taskProgress: null,
      contextTokens,
    };
  }

  return createDebounceWatcher({
    session,
    label: "codex: session",
    debounceMs: WAL_DEBOUNCE_MS,
    db: watcherContext,
    subscribe: (onEvent, onError, plog) =>
      subscribeCodexDb(
        executor,
        session.dbPath,
        session.walPath,
        onEvent,
        onError,
        plog,
      ),
    refresh: readInfo,
    isEqual: agentInfoEqual,
    onChange: (info) => {
      log?.debug(
        {
          state: info.state,
          model: info.model,
          session: info.sessionId,
          tokens: info.contextTokens,
        },
        "codex state updated",
      );
      onChange(info);
    },
    logCtx: { session: session.id },
    log,
  });
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
