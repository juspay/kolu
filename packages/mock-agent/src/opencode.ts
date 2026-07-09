/**
 * OpenCode artifacts, written by the mock-agent AS the agent (relocated from the
 * old test-side `agent-mock-opencode.ts` — same single SQLite DB with the
 * `session`/`message`/`part`/`todo` tables the kolu opencode provider reads).
 *
 * The `directory` column is `process.cwd()` — the terminal the mock-agent runs
 * in — so the provider's cwd match is against the real cwd, as production sees.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { opencodeDbPath } from "./paths.ts";
import type { AgentState, MockKind, StateOpts } from "./protocol.ts";

const SESSION_ID = "opencode-mock-session-0001";

const SCHEMA = `
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

export class OpenCodeAgent implements MockKind {
  private readonly dbPath = opencodeDbPath();
  private readonly cwd = process.cwd();
  private conn: DatabaseSync | null = null;

  /** ONE long-lived WAL connection for the agent's lifetime — see the codex
   *  agent's `db()` for why: closing a per-write connection checkpoints and
   *  recreates `-wal`, leaving the server's `fs.watch` on the WAL watching a
   *  dead inode so subsequent writes go unseen. */
  private db(): DatabaseSync {
    if (this.conn) return this.conn;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    this.conn = db;
    return db;
  }

  setState(state: AgentState, opts: StateOpts): void {
    const db = this.db();
    // DELETE+INSERT inside one transaction so a concurrent reader sees either
    // the old or new state, never a session-less half-rewrite that clears the
    // indicator to null/null.
    db.exec("BEGIN IMMEDIATE;");
    db.prepare("DELETE FROM session WHERE id = ? OR directory = ?").run(
      SESSION_ID,
      this.cwd,
    );
    db.prepare("DELETE FROM message WHERE session_id = ?").run(SESSION_ID);
    db.prepare(
      "DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id = ?)",
    ).run(SESSION_ID);
    db.prepare("DELETE FROM todo WHERE session_id = ?").run(SESSION_ID);

    const now = Date.now();
    db.prepare(
      "INSERT INTO session (id, title, directory, time_updated, time_archived) VALUES (?, ?, ?, ?, NULL)",
    ).run(
      SESSION_ID,
      opts.title ?? "opencode-mock test session",
      this.cwd,
      now,
    );

    const modelID = "qwen2.5-coder";
    const providerID = "test";
    const assistantId = `${SESSION_ID}-m-assistant`;
    const userId = `${SESSION_ID}-m-user`;

    if (state === "thinking") {
      // Optional earlier assistant row carrying the running token total —
      // found via a role='assistant' query, so the user message as newest row
      // still derives `thinking`.
      if (opts.contextTokens !== undefined) {
        db.prepare(
          "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
        ).run(
          assistantId,
          SESSION_ID,
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
        SESSION_ID,
        now,
        JSON.stringify({ role: "user", time: { created: now } }),
      );
    } else if (state === "tool_use") {
      db.prepare(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      ).run(
        assistantId,
        SESSION_ID,
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
        SESSION_ID,
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
          SESSION_ID,
          i < opts.todos.completed ? "completed" : "pending",
        );
      }
    }
    db.exec("COMMIT;");
  }

  nudge(): void {
    // No-op — see CodexAgent.nudge(): a WAL self-kick starves the provider's
    // debounce; each setState's own commit is the signal.
  }

  remove(): void {
    if (!this.conn) return;
    this.conn
      .prepare("DELETE FROM session WHERE id = ? OR directory = ?")
      .run(SESSION_ID, this.cwd);
  }
}
