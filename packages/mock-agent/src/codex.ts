/**
 * Codex artifacts, written by the mock-agent AS the agent (relocated verbatim
 * from the old test-side `agent-mock-codex.ts` — same SQLite + rollout shapes,
 * a subset of what the real Codex CLI writes: any parser regression fails here
 * the same way it would under a real session).
 *
 * The one behavioural change from the old ventriloquist mock: the row's `cwd` is
 * `process.cwd()` — the terminal the mock-agent runs in — not a value the test
 * chose from outside. The Codex provider matches purely on `state.cwd`, so a
 * process writing its own cwd is exactly what production senses.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { codexDir } from "./paths.ts";
import type { AgentState, MockKind, StateOpts } from "./protocol.ts";

const THREAD_ID = "00000000-0000-0000-0000-000000000001";

function buildRollout(opts: {
  state: AgentState;
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
    if (opts.cachedInputTokens !== undefined)
      usage.cached_input_tokens = opts.cachedInputTokens;
    lines.push(
      JSON.stringify({
        type: "event_msg",
        payload: { type: "token_count", info: { last_token_usage: usage } },
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

/** One WAL commit frame with a namespaced transient row — the self-nudge that
 *  re-fires the server's WAL watcher so a dropped inotify event can't wedge
 *  detection. Replaces the old test-side `onTick: nudgeCodex`. */
const NUDGE_SQL = `BEGIN; INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms) VALUES ('__kolu_nudge__', '', '', 'cli', 0, 0); DELETE FROM threads WHERE id = '__kolu_nudge__'; COMMIT;`;

export class CodexAgent implements MockKind {
  private readonly dir = codexDir();
  private readonly dbPath = join(this.dir, "state_5.sqlite");
  private readonly cwd = process.cwd();
  private rolloutPath = join(this.dir, `rollout-${process.pid}.jsonl`);

  setState(state: AgentState, opts: StateOpts): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      this.rolloutPath,
      buildRollout({
        state,
        inputTokens: opts.inputTokens,
        cachedInputTokens: opts.cachedInputTokens,
      }),
    );
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec("PRAGMA journal_mode = WAL;");
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
      // Atomic row-swap: a reader landing between DELETE and INSERT must never
      // see zero rows for this cwd (which clears the indicator to null). Mirrors
      // the real Codex CLI's transactional write.
      db.exec("BEGIN IMMEDIATE;");
      try {
        db.prepare("DELETE FROM threads WHERE cwd = ?").run(this.cwd);
        db.prepare(
          "INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms, title, model) VALUES (?, ?, ?, 'cli', 0, ?, ?, ?)",
        ).run(
          THREAD_ID,
          this.rolloutPath,
          this.cwd,
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
  }

  nudge(): void {
    if (!existsSync(this.dbPath)) return;
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec(NUDGE_SQL);
    } finally {
      db.close();
    }
  }

  remove(): void {
    if (!existsSync(this.dbPath)) return;
    const db = new DatabaseSync(this.dbPath);
    try {
      // Row-delete, not file-unlink: unlinking would break the server's WAL
      // inotify handle. Deleting this cwd's thread row reproduces the "session
      // gone" clear the old `clearMockDatabase` produced.
      db.prepare("DELETE FROM threads WHERE cwd = ?").run(this.cwd);
    } finally {
      db.close();
    }
  }
}
