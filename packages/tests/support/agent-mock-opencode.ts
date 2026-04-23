/**
 * Fixture builder for OpenCode mock e2e tests.
 *
 * The real OpenCode TUI owns a single SQLite database at
 * `~/.local/share/opencode/opencode.db`. The kolu provider opens it
 * read-only and derives state from the latest message's `data` JSON
 * blob plus the matching tool-`part` rows. This helper synthesizes the
 * same tables directly so e2e scenarios can drive the provider through
 * a controlled lifecycle without launching a real `opencode` TUI.
 *
 * The SQL schema and JSON shapes here are a subset of what the real
 * TUI writes — only the columns and fields the kolu opencode provider
 * actually reads. That subset is the contract this fixture exercises.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

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
