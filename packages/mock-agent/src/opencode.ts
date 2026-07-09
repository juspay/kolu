/**
 * OpenCode artifacts, written by the mock-agent AS the agent (relocated from the
 * old test-side `agent-mock-opencode.ts` — same single SQLite DB with the
 * `session`/`message`/`part`/`todo` tables the kolu opencode provider reads).
 *
 * The `directory` column is `process.cwd()` — the terminal the mock-agent runs
 * in — so the provider's cwd match is against the real cwd, as production sees.
 */

import { mkdirSync, utimesSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { opencodeDbPath } from "./paths.ts";
import type { AgentState, MockKind, StateOpts } from "./protocol.ts";

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
  private wrote = false;
  /** Bumped on every setState so the product sessionKey changes and a fresh
   *  watcher attaches. Darwin's held SQLite connection + kqueue can miss
   *  mid-session WAL frames for a single session id, leaving the tile stuck
   *  on the first state; a new session id forces re-resolve + initial emit. */
  private sessionSeq = 0;
  private sessionId = "opencode-mock-session-0001";
  /** Re-runs the last write; bin.ts's nudge loop calls `nudge()` to replay it. */
  private replay: (() => void) | null = null;

  /** Open a FRESH WAL connection, ensure the schema, run `fn`, then CLOSE it.
   *  Open-write-close per transition mirrors real OpenCode (and the pre-mock
   *  fixture): each close recreates the `-wal`, a reliable fs event for the
   *  provider's watcher on every platform. (The darwin root cause was the
   *  scenario cwd under `/tmp`; see `CodexAgent.withDb` and mockAgent.ts.) */
  private withDb(fn: (db: DatabaseSync) => void): void {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec(SCHEMA);
      fn(db);
    } finally {
      db.close();
    }
    // Extra FSEvents poke: after close, explicitly touch the db + wal so a
    // watcher that missed the inode recreate (darwin kqueue under load) still
    // re-reads. No-ops if the -wal was already checkpointed away.
    const now = new Date();
    try {
      utimesSync(this.dbPath, now, now);
    } catch {
      /* gone */
    }
    try {
      utimesSync(`${this.dbPath}-wal`, now, now);
    } catch {
      /* checkpointed away */
    }
  }

  setState(state: AgentState, opts: StateOpts): void {
    this.sessionSeq += 1;
    this.sessionId = `opencode-mock-session-${String(this.sessionSeq).padStart(4, "0")}`;
    this.writeSession(state, opts);
    this.replay = () => this.writeSession(state, opts);
  }

  /** Open-write-CLOSE the session/message/part/todo rows — the WAL trigger that
   *  encodes the opencode state. See `CodexAgent.writeThreadRow`. */
  private writeSession(state: AgentState, opts: StateOpts): void {
    const sessionId = this.sessionId;
    this.withDb((db) => {
      // DELETE+INSERT inside one transaction so a concurrent reader sees either
      // the old or new state, never a session-less half-rewrite that clears the
      // indicator to null/null. Wipe by directory so a prior session-seq row for
      // this cwd can't linger as the match target.
      db.exec("BEGIN IMMEDIATE;");
      db.prepare(
        "DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id IN (SELECT id FROM session WHERE directory = ?))",
      ).run(this.cwd);
      db.prepare(
        "DELETE FROM message WHERE session_id IN (SELECT id FROM session WHERE directory = ?)",
      ).run(this.cwd);
      db.prepare(
        "DELETE FROM todo WHERE session_id IN (SELECT id FROM session WHERE directory = ?)",
      ).run(this.cwd);
      db.prepare("DELETE FROM session WHERE directory = ? OR id = ?").run(
        this.cwd,
        sessionId,
      );

      const now = Date.now();
      db.prepare(
        "INSERT INTO session (id, title, directory, time_updated, time_archived) VALUES (?, ?, ?, ?, NULL)",
      ).run(
        sessionId,
        opts.title ?? "opencode-mock test session",
        this.cwd,
        now,
      );

      const modelID = "qwen2.5-coder";
      const providerID = "test";
      const assistantId = `${sessionId}-m-assistant`;
      const userId = `${sessionId}-m-user`;

      if (state === "thinking") {
        // Optional earlier assistant row carrying the running token total —
        // found via a role='assistant' query, so the user message as newest row
        // still derives `thinking`.
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
      } else if (state === "tool_use" || state === "awaiting_user") {
        // Unfinished assistant turn + a running tool part. Real-work tools
        // (`shell` etc.) → product tool_use; AWAITING_USER_TOOLS (`question` /
        // `plan_exit`) → awaiting_user. The previous else-branch used
        // `finish: "stop"` for awaiting_user, which the product folds to waiting.
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
          JSON.stringify({
            type: "tool",
            tool: state === "awaiting_user" ? "question" : "shell",
            state: { status: "running" },
          }),
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
      db.exec("COMMIT;");
    });
    this.wrote = true;
  }

  nudge(): void {
    // Re-fire the last write; bin.ts's loop calls this so a dropped WAL fs event
    // under N-worker load is retried — see `CodexAgent.nudge`.
    this.replay?.();
  }

  remove(): void {
    if (!this.wrote) {
      this.replay = null;
      return;
    }
    // The deletion is its own WAL frame — the "session gone" clear. Make it the
    // replay so bin.ts keeps re-firing it for the removal window.
    this.replay = () =>
      this.withDb((db) => {
        db.prepare("DELETE FROM session WHERE directory = ?").run(this.cwd);
      });
    this.replay();
  }
}
