/**
 * Fixture builder for OpenCode mock e2e tests.
 *
 * The real OpenCode TUI owns a single SQLite database at
 * `~/.local/share/opencode/opencode.db`. The kolu provider opens it
 * read-only and derives state from the latest `session_message` row —
 * its `type` column plus its `data` JSON blob, whose `content[]` carries
 * the message's tool parts inline. This helper synthesizes the same
 * OpenCode 2.x tables directly so e2e scenarios can drive the provider
 * through a controlled lifecycle without launching a real `opencode` TUI.
 *
 * The SQL schema and JSON shapes here are a subset of what the real
 * TUI (2.0.29) writes — only the columns and fields the kolu opencode
 * provider actually reads. That subset is the contract this fixture
 * exercises.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

const OPENCODE_SCHEMA = `
CREATE TABLE IF NOT EXISTS session_v2 (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  directory TEXT NOT NULL,
  title TEXT,
  revert TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  time_archived INTEGER
);
CREATE TABLE IF NOT EXISTS session_message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  seq INTEGER NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS session_message_session_seq_idx ON session_message (session_id, seq);
CREATE INDEX IF NOT EXISTS session_message_session_type_seq_idx ON session_message (session_id, type, seq);
CREATE INDEX IF NOT EXISTS session_message_session_time_created_id_idx ON session_message (session_id, time_created, id);
`;

export interface OpenCodeFixture {
  dbPath: string;
  sessionId: string;
}

/** Create OpenCode's SQLite database under `dbPath` with a single session
 *  in the requested lifecycle state.
 *
 *  State derivation mirrors `deriveSessionState` / `parseMessageState`:
 *   - thinking: latest conversational row is a `user` message (the
 *     token-bearing `assistant` row, if any, is an earlier one)
 *   - tool_use: latest `assistant` row has no `time.completed`, and a
 *     `content[]` tool part with `state.status = "running"`
 *   - awaiting_user: as tool_use, but the running tool is `question`
 *   - waiting:  latest `assistant` row has `time.completed` + `finish = "stop"`
 *  `contextTokens` lands as the assistant row's `tokens.input` (the other
 *  usage fields zero), so the published sum equals it.
 */
export function writeOpenCodeFixture(opts: {
  dbPath: string;
  cwd: string;
  state: AgentLifecycleState;
  contextTokens?: number;
  title?: string;
  model?: { id: string; providerID: string };
}): OpenCodeFixture {
  fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  const sessionId = "opencode-mock-session-0001";
  const db = new DatabaseSync(opts.dbPath);
  try {
    // Enable WAL so (a) the server's reader and our writer don't block
    // each other, and (b) the WAL sidecar file the opencode watcher
    // listens on actually exists. Real OpenCode uses WAL too.
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(OPENCODE_SCHEMA);

    // Wrap the DELETE+INSERT sequence in BEGIN/COMMIT so a concurrent
    // reader (the server's session-watcher refresh, fired by `nudgeWal`
    // on each poll tick) sees either the old state or the new state —
    // never a transient half-rewritten one where the session row is
    // gone. Without this, on state-change scenarios the agent provider
    // can observe "no session for cwd" mid-rewrite, destroy the matched
    // watcher, and clear the indicator to null/null; the next reconcile
    // sees the new row and re-matches, but on a busy x86_64-linux
    // builder the window can outlast the test's 20 s poll budget.
    db.exec("BEGIN IMMEDIATE;");
    db.prepare("DELETE FROM session_v2 WHERE id = ? OR directory = ?").run(
      sessionId,
      opts.cwd,
    );
    db.prepare("DELETE FROM session_message WHERE session_id = ?").run(
      sessionId,
    );

    const now = Date.now();
    db.prepare(
      "INSERT INTO session_v2 (id, title, directory, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, NULL)",
    ).run(
      sessionId,
      opts.title ?? "opencode-mock test session",
      opts.cwd,
      now,
      now,
    );

    const model = opts.model ?? { id: "qwen2.5-coder", providerID: "test" };
    const tokens =
      opts.contextTokens === undefined
        ? undefined
        : {
            input: opts.contextTokens,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          };

    let seq = 0;
    const insert = (
      type: "user" | "assistant",
      time: number,
      data: Record<string, unknown>,
    ) => {
      db.prepare(
        "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        `${sessionId}-m${seq}`,
        sessionId,
        type,
        seq,
        time,
        time,
        JSON.stringify(data),
      );
      seq++;
    };

    const runningTool = (name: string) => ({
      time: { created: now },
      model,
      ...(tokens && { tokens }),
      content: [
        {
          type: "tool",
          id: "call_1",
          name,
          executed: false,
          state: { status: "running", input: {} },
        },
      ],
    });

    if (opts.state === "thinking") {
      // Optional earlier assistant row carrying the token usage —
      // `getLatestAssistantFacts` reads the newest assistant row through a
      // separate query scoped to `type='assistant'` (that row is also where
      // the session-scoped model comes from), so the user message as the
      // newest row still drives state derivation to `thinking`.
      if (tokens) {
        insert("assistant", now - 10, {
          time: { created: now - 10, completed: now - 5 },
          model,
          finish: "stop",
          tokens,
          content: [{ type: "text", text: "Done." }],
        });
      }
      insert("user", now, { time: { created: now }, text: "next" });
    } else if (opts.state === "tool_use") {
      insert("assistant", now, runningTool("shell"));
    } else if (opts.state === "awaiting_user") {
      insert("assistant", now, runningTool("question"));
    } else {
      insert("assistant", now, {
        time: { created: now, completed: now },
        model,
        finish: "stop",
        ...(tokens && { tokens }),
        content: [{ type: "text", text: "Done." }],
      });
    }

    db.exec("COMMIT;");
  } finally {
    db.close();
  }

  return { dbPath: opts.dbPath, sessionId };
}
