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
  private conn: DatabaseSync | null = null;

  /** ONE long-lived WAL connection for the agent's lifetime. Opening + closing
   *  a fresh connection per write (the obvious shape) is subtly fatal here: on
   *  the last connection's close SQLite checkpoints and RECREATES the `-wal`
   *  file, so the server's `fs.watch` on `state_5.sqlite-wal` is left watching a
   *  dead inode and never fires again — the mock's second write (and every
   *  self-nudge) then goes unseen. Holding the connection open keeps the `-wal`
   *  inode stable so every write reaches the watcher. */
  private db(): DatabaseSync {
    if (this.conn) return this.conn;
    mkdirSync(this.dir, { recursive: true });
    const db = new DatabaseSync(this.dbPath);
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
    this.conn = db;
    return db;
  }

  setState(state: AgentState, opts: StateOpts): void {
    // Open the connection FIRST — `db()` creates `~/.codex`, so the rollout
    // write below has a directory to land in.
    const db = this.db();
    writeFileSync(
      this.rolloutPath,
      buildRollout({
        state,
        inputTokens: opts.inputTokens,
        cachedInputTokens: opts.cachedInputTokens,
      }),
    );
    // Atomic row-swap: a reader landing between DELETE and INSERT must never
    // see zero rows for this cwd (which clears the indicator to null). Mirrors
    // the real Codex CLI's transactional write. DELETE by cwd OR the fixed
    // THREAD_ID (a primary key): the id is constant across scenarios (the
    // sleeping-terminals journey asserts `codex resume <THREAD_ID>`), so a
    // PRIOR scenario's row — written at a DIFFERENT cwd — must be cleared too,
    // else re-inserting THREAD_ID trips a UNIQUE constraint.
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
  }

  nudge(): void {
    // No-op: codex's provider watches the SQLite WAL, which is reliable here (a
    // persistent connection keeps the `-wal` inode stable). A periodic self-kick
    // would only HURT — it fires the WAL faster than the provider's 150ms
    // trailing debounce can settle, starving `performRefresh` so a real state
    // change is never re-read. Each `setState`'s own WAL commit already wakes the
    // watcher; that's the whole signal.
    //
    // Recovery story if that single commit's fs event IS lost: there is no
    // per-tick kick to re-fire it. Under heavy N-worker parallel load a commit's
    // notification can be coalesced/dropped, and on darwin the provider's WAL
    // `fs.watch` is itself fragile (#1680) — in both cases the indicator stays
    // null until the scenario's next `setState` or the `CUCUMBER_RETRY` re-run.
    // Closing that gap with a periodic kick is rejected on purpose (it starves
    // the debounce, above); it is the accepted trade vs the old per-tick nudge.
  }

  remove(): void {
    if (!this.conn) return;
    // Row-delete, not file-unlink: unlinking would break the server's WAL
    // inotify handle. Deleting this cwd's thread row reproduces the "session
    // gone" clear the old `clearMockDatabase` produced.
    this.conn.prepare("DELETE FROM threads WHERE cwd = ?").run(this.cwd);
  }
}
