/**
 * Fixture builders for Codex and OpenCode mock e2e tests.
 *
 * The real Codex and OpenCode CLIs write their state into a SQLite DB
 * (+ a JSONL rollout for Codex). These helpers synthesize the same
 * on-disk artefacts directly so e2e scenarios can drive the providers
 * through a controlled lifecycle without spinning up live agent CLIs.
 *
 * Schemas are a subset of what the real tools write — only the columns
 * and JSON fields the kolu providers actually read. That subset is the
 * real contract we're exercising; any parser regression (e.g. the
 * token-accounting bugs fixed in 944f19d and 431edd3) will fail here
 * the same way it would under a real session.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type AgentLifecycleState = "thinking" | "tool_use" | "waiting";

// --- Codex ---

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

// --- OpenCode ---

const OPENCODE_SCHEMA = `
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  title TEXT,
  directory TEXT NOT NULL,
  time_updated INTEGER NOT NULL,
  time_archived INTEGER
);
CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_session_idx ON message(session_id, time_created);
CREATE TABLE IF NOT EXISTS part (
  id TEXT,
  message_id TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS part_message_id_id_idx ON part(message_id, id);
CREATE TABLE IF NOT EXISTS todo (
  id TEXT,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL
);
`;

export interface OpenCodeFixture {
  dbPath: string;
  sessionId: string;
}

/** Create OpenCode's SQLite database under `dbPath` with a single session
 *  in the requested lifecycle state.
 *
 *  State derivation mirrors `parseMessageState` + `hasRunningTools`:
 *   - thinking: latest row is a `user` message (assistant-token bookkeeping
 *     lives on an earlier `assistant` row)
 *   - tool_use: latest assistant message has no `time.completed`, plus a
 *     `part` row with `data.state.status = "running"`
 *   - waiting:  latest assistant message has `time.completed` + `finish = "stop"`
 */
export function writeOpenCodeFixture(opts: {
  dbPath: string;
  cwd: string;
  state: AgentLifecycleState;
  contextTokens?: number;
  todos?: { total: number; completed: number };
  title?: string;
  modelID?: string;
  providerID?: string;
}): OpenCodeFixture {
  fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  const sessionId = "opencode-mock-session-0001";
  const db = new DatabaseSync(opts.dbPath);
  try {
    db.exec(OPENCODE_SCHEMA);

    db.prepare("DELETE FROM session WHERE id = ? OR directory = ?").run(
      sessionId,
      opts.cwd,
    );
    db.prepare("DELETE FROM message WHERE session_id = ?").run(sessionId);
    db.prepare(
      "DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id = ?)",
    ).run(sessionId);
    db.prepare("DELETE FROM todo WHERE session_id = ?").run(sessionId);

    const now = Date.now();
    db.prepare(
      "INSERT INTO session (id, title, directory, time_updated, time_archived) VALUES (?, ?, ?, ?, NULL)",
    ).run(sessionId, opts.title ?? "opencode-mock test session", opts.cwd, now);

    const modelID = opts.modelID ?? "qwen2.5-coder";
    const providerID = opts.providerID ?? "test";

    const assistantId = `${sessionId}-m-assistant`;
    const userId = `${sessionId}-m-user`;

    if (opts.state === "thinking") {
      // Optional earlier assistant row carrying the running token total —
      // `getLatestAssistantContextTokens` finds it via a separate query
      // scoped to `role='assistant'`, so the user message as the newest
      // row still drives state derivation to `thinking`.
      if (opts.contextTokens !== undefined) {
        db.prepare(
          "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        ).run(
          assistantId,
          sessionId,
          now - 10,
          JSON.stringify({
            role: "assistant",
            modelID,
            providerID,
            finish: "stop",
            time: { created: now - 10, completed: now - 5 },
            tokens: { total: opts.contextTokens },
          }),
        );
      }
      db.prepare(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      ).run(
        userId,
        sessionId,
        now,
        JSON.stringify({ role: "user", time: { created: now } }),
      );
    } else if (opts.state === "tool_use") {
      db.prepare(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      ).run(
        assistantId,
        sessionId,
        now,
        JSON.stringify({
          role: "assistant",
          modelID,
          providerID,
          time: { created: now },
          ...(opts.contextTokens !== undefined && {
            tokens: { total: opts.contextTokens },
          }),
        }),
      );
      db.prepare(
        "INSERT INTO part (id, message_id, data) VALUES (?, ?, ?)",
      ).run(
        "p1",
        assistantId,
        JSON.stringify({ type: "tool", state: { status: "running" } }),
      );
    } else {
      db.prepare(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      ).run(
        assistantId,
        sessionId,
        now,
        JSON.stringify({
          role: "assistant",
          modelID,
          providerID,
          finish: "stop",
          time: { created: now, completed: now },
          ...(opts.contextTokens !== undefined && {
            tokens: { total: opts.contextTokens },
          }),
        }),
      );
    }

    if (opts.todos) {
      for (let i = 0; i < opts.todos.total; i++) {
        db.prepare(
          "INSERT INTO todo (id, session_id, status) VALUES (?, ?, ?)",
        ).run(
          `t${i}`,
          sessionId,
          i < opts.todos.completed ? "completed" : "pending",
        );
      }
    }
  } finally {
    db.close();
  }

  return { dbPath: opts.dbPath, sessionId };
}
