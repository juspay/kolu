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

import { mkdirSync, writeFileSync } from "node:fs";
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

export class CodexAgent implements MockKind {
  private readonly dir = codexDir();
  private readonly dbPath = join(this.dir, "state_5.sqlite");
  private readonly cwd = process.cwd();
  private rolloutPath = join(this.dir, `rollout-${process.pid}.jsonl`);
  private wrote = false;
  private kickTimer: ReturnType<typeof setInterval> | null = null;

  /** Open a FRESH WAL connection, ensure the schema, run `fn`, then CLOSE it.
   *  Open-write-CLOSE per transition is load-bearing on darwin: closing the last
   *  connection makes SQLite checkpoint and RECREATE the `-wal` file, and that
   *  inode churn is the fs event darwin's kqueue watcher fires on. A stable-inode
   *  append under a HELD connection is invisible to kqueue — that was the bug: a
   *  persistent connection passed on linux (inotify sees the append) but read
   *  `null` on darwin (kqueue saw no inode event). The server's WAL watcher
   *  re-arms on the recreated inode via its parent-directory watcher, so no event
   *  is lost. This mirrors what the real Codex CLI (open-write-close per turn) and
   *  the pre-mock-agent fixture did — and darwin CI passed on both. */
  private withDb(fn: (db: DatabaseSync) => void): void {
    mkdirSync(this.dir, { recursive: true });
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
      fn(db);
    } finally {
      db.close();
    }
  }

  setState(state: AgentState, opts: StateOpts): void {
    // Ensure `~/.codex` exists so the rollout write below has a directory. The
    // rollout JSONL carries the STATE; the DB write is only the WAL trigger that
    // wakes the provider to re-read the rollout.
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      this.rolloutPath,
      buildRollout({
        state,
        inputTokens: opts.inputTokens,
        cachedInputTokens: opts.cachedInputTokens,
      }),
    );
    this.writeThreadRow(opts);
    this.startKick(opts);
  }

  /** Open-write-CLOSE the thread row — the WAL trigger. Atomic row-swap: a reader
   *  landing between DELETE and INSERT must never see zero rows for this cwd
   *  (which clears the indicator to null). DELETE by cwd OR the fixed THREAD_ID (a
   *  primary key): the id is constant across scenarios (the sleeping-terminals
   *  journey asserts `codex resume <THREAD_ID>`), so a PRIOR scenario's row —
   *  written at a DIFFERENT cwd — must be cleared too, else re-inserting THREAD_ID
   *  trips a UNIQUE constraint. */
  private writeThreadRow(opts: StateOpts): void {
    this.withDb((db) => {
      db.exec("BEGIN IMMEDIATE;");
      try {
        db.prepare("DELETE FROM threads WHERE cwd = ? OR id = ?").run(
          this.cwd,
          THREAD_ID,
        );
        db.prepare(
          "INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms, title, model) VALUES (?, ?, ?, 'cli', 0, ?, ?, ?)",
        ).run(
          THREAD_ID,
          this.rolloutPath,
          this.cwd,
          Date.now(),
          opts.title ?? "codex-mock test thread",
          "gpt-5",
        );
        db.exec("COMMIT;");
      } catch (e) {
        db.exec("ROLLBACK;");
        throw e;
      }
    });
    this.wrote = true;
  }

  /** Re-write the thread row on a fixed interval so a DROPPED WAL fs event is
   *  RETRIED. A single WAL-frame event can be coalesced/missed by darwin's
   *  FSEvents (the immediate, systematic null on darwin) — and under N-worker
   *  load by inotify too; repeating the write re-fires the watcher until the
   *  provider reconciles, exactly as real Codex (a write per turn) and the
   *  pre-mock-agent fixture's per-poll nudge did (both green on darwin). The
   *  interval is > the provider's 150ms trailing debounce so each re-write
   *  settles into one `performRefresh` rather than starving it. Reset per
   *  setState, cleared on remove/quit; unref'd so it never keeps the process
   *  alive past the terminal closing stdin. */
  private startKick(opts: StateOpts): void {
    this.stopKick();
    this.kickTimer = setInterval(() => this.writeThreadRow(opts), 250);
    this.kickTimer.unref?.();
  }

  private stopKick(): void {
    if (this.kickTimer) {
      clearInterval(this.kickTimer);
      this.kickTimer = null;
    }
  }

  nudge(): void {
    // No-op: `startKick` is the standing retry signal; a caller-driven nudge
    // would be redundant.
  }

  remove(): void {
    this.stopKick();
    if (!this.wrote) return;
    // Row-delete, not file-unlink: unlinking would break the server's WAL
    // handle. Deleting the row is its own WAL frame — the "session gone" clear
    // the old `clearMockDatabase` produced.
    this.withDb((db) => {
      db.prepare("DELETE FROM threads WHERE cwd = ?").run(this.cwd);
    });
  }
}
