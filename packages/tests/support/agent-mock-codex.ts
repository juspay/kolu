/**
 * Fixture builders for Codex mock e2e tests.
 *
 * The real Codex CLI writes thread metadata into `state_<N>.sqlite` and
 * the per-turn rollout into `sessions/.../rollout-*.jsonl`. These
 * helpers synthesize the same on-disk artefacts directly so e2e
 * scenarios can drive the Codex provider through a controlled lifecycle
 * without spinning up the CLI or a backing LLM.
 *
 * The SQLite + JSONL shapes here are a subset of what the real CLI
 * writes — only the columns and JSON fields the kolu codex provider
 * actually reads. That subset is the real contract we're exercising;
 * any parser regression (e.g. the token-accounting bugs fixed in
 * 944f19d and 431edd3) will fail here the same way it would under a
 * real session.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

/** Build a Codex rollout JSONL that terminates in the requested state.
 *
 *  Mirrors the subset of events `parseRolloutState` reads:
 *   - `event_msg.task_started`   → lifecycle starts
 *   - `response_item.function_call` / `function_call_output` with
 *     matching `call_id` → tool_use open/close
 *   - `event_msg.task_complete`  → lifecycle ends (waiting)
 *   - `event_msg.token_count`    → context-token accounting
 */
export function buildCodexRollout(opts: {
  state: AgentLifecycleState;
  inputTokens?: number;
  cachedInputTokens?: number;
}): string {
  const lines: string[] = [];

  lines.push(
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn-1" },
    }),
  );

  if (opts.inputTokens !== undefined) {
    const usage: { input_tokens: number; cached_input_tokens?: number } = {
      input_tokens: opts.inputTokens,
    };
    if (opts.cachedInputTokens !== undefined) {
      usage.cached_input_tokens = opts.cachedInputTokens;
    }
    lines.push(
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: usage },
        },
      }),
    );
  }

  if (opts.state === "tool_use") {
    lines.push(
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call", call_id: "call-1" },
      }),
    );
  }

  if (opts.state === "waiting") {
    lines.push(
      JSON.stringify({
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1" },
      }),
    );
  }

  return lines.join("\n") + "\n";
}

export interface CodexFixture {
  dbPath: string;
  rolloutPath: string;
  threadId: string;
}

/** Create Codex's threads SQLite DB and rollout JSONL under `codexDir`.
 *  `state_5.sqlite` is the fallback path the config picks when the dir
 *  is empty, so tests and production agree on the same filename without
 *  an extra env override.
 *
 *  Idempotent: re-running with the same `cwd` replaces the previous
 *  thread row so scenarios can transition states without stale rows. */
export function writeCodexFixture(opts: {
  codexDir: string;
  cwd: string;
  state: AgentLifecycleState;
  inputTokens?: number;
  cachedInputTokens?: number;
  title?: string;
  model?: string;
}): CodexFixture {
  fs.mkdirSync(opts.codexDir, { recursive: true });
  const dbPath = path.join(opts.codexDir, "state_5.sqlite");
  const rolloutPath = path.join(
    opts.codexDir,
    `rollout-${process.pid}-${Date.now()}.jsonl`,
  );
  const threadId = "00000000-0000-0000-0000-000000000001";

  fs.writeFileSync(rolloutPath, buildCodexRollout(opts));

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        cwd TEXT NOT NULL,
        source TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL,
        title TEXT,
        model TEXT
      );
    `);
    db.prepare("DELETE FROM threads WHERE cwd = ?").run(opts.cwd);
    db.prepare(
      "INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms, title, model) VALUES (?, ?, ?, 'cli', 0, ?, ?, ?)",
    ).run(
      threadId,
      rolloutPath,
      opts.cwd,
      Date.now(),
      opts.title ?? "codex-mock test thread",
      opts.model ?? "gpt-5",
    );
  } finally {
    db.close();
  }

  return { dbPath, rolloutPath, threadId };
}

/** Rewrite the rollout JSONL in place to transition the session state.
 *  Used by scenarios that move thinking → waiting etc. without tearing
 *  down the thread row or the watcher. */
export function updateCodexRollout(
  rolloutPath: string,
  opts: {
    state: AgentLifecycleState;
    inputTokens?: number;
    cachedInputTokens?: number;
  },
): void {
  fs.writeFileSync(rolloutPath, buildCodexRollout(opts));
}
