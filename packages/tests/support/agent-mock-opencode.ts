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

export function writeOpenCodeFixture(opts: {
  dbPath: string;
  cwd: string;
  state: AgentLifecycleState;
  contextTokens?: number;
}): OpenCodeFixture {
  fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  const sessionId = "opencode-mock-session-0001";
  const db = new DatabaseSync(opts.dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(OPENCODE_SCHEMA);

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
    ).run(sessionId, "opencode-mock test session", opts.cwd, now, now);

    const model = { id: "qwen2.5-coder", providerID: "test" };
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
        { type: "tool", id: "call_1", name, state: { status: "running" } },
      ],
    });
    const finished = (time: number) => ({
      time: { created: time, completed: time },
      model,
      finish: "stop",
      ...(tokens && { tokens }),
      content: [{ type: "text", text: "Done." }],
    });

    if (opts.state === "thinking") {
      if (tokens) insert("assistant", now - 10, finished(now - 10));
      insert("user", now, { time: { created: now }, text: "next" });
    } else if (opts.state === "tool_use") {
      insert("assistant", now, runningTool("shell"));
    } else if (opts.state === "awaiting_user") {
      insert("assistant", now, runningTool("question"));
    } else {
      insert("assistant", now, finished(now));
    }

    db.exec("COMMIT;");
  } finally {
    db.close();
  }

  return { dbPath: opts.dbPath, sessionId };
}
