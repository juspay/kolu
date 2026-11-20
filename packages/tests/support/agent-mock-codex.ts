import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

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

  return `${lines.join("\n")}\n`;
}

export interface CodexFixture {
  dbPath: string;
  rolloutPath: string;
  threadId: string;
}

const CODEX_FIXTURE_BUSY_TIMEOUT_MS = 5_000;

function configureFixtureDatabase(db: DatabaseSync): void {
  db.exec(`PRAGMA busy_timeout = ${CODEX_FIXTURE_BUSY_TIMEOUT_MS};`);
  db.exec("PRAGMA journal_mode = WAL;");
}

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
    configureFixtureDatabase(db);
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
    db.exec("BEGIN IMMEDIATE;");
    try {
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
      db.exec("COMMIT;");
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    }
  } finally {
    db.close();
  }

  return { dbPath, rolloutPath, threadId };
}

export function updateCodexRollout(
  fixture: CodexFixture,
  opts: {
    state: AgentLifecycleState;
    inputTokens?: number;
    cachedInputTokens?: number;
  },
): void {
  fs.writeFileSync(fixture.rolloutPath, buildCodexRollout(opts));
  const db = new DatabaseSync(fixture.dbPath);
  try {
    configureFixtureDatabase(db);
    db.exec(`
      BEGIN;
      INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms)
        VALUES ('__kick__', '', '', 'cli', 0, 0);
      DELETE FROM threads WHERE id = '__kick__';
      COMMIT;
    `);
    db.prepare("UPDATE threads SET updated_at_ms = ? WHERE id = ?").run(
      Date.now(),
      fixture.threadId,
    );
  } finally {
    db.close();
  }
}
