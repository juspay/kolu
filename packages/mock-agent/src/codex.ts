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

/** Fixed uuidv7 so product `uuidV7TimestampMs` decodes a real `startedAt`
 *  (a non-v7 id yields null). Epoch-ms = 0 from the leading 48 bits — fine
 *  for e2e; the sleeping-terminals journey asserts this id in the resume
 *  command. Version nibble `7`, variant `8`. */
const THREAD_ID = "00000000-0000-7000-8000-000000000001";

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
        payload: {
          type: "function_call",
          call_id: "call-1",
          name: "shell",
        },
      }),
    );
  }
  if (opts.state === "awaiting_user") {
    // Open user-blocking tool with no function_call_output → product
    // `parseRolloutState` returns awaiting_user (AWAITING_USER_TOOLS).
    lines.push(
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call",
          call_id: "call-await",
          name: "request_user_input",
        },
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
  /** Re-runs the last write; the bin.ts nudge loop calls `nudge()` on a cadence
   *  to replay it (dropped-fs-event retry). Null until the first setState. */
  private replay: (() => void) | null = null;

  /** Open a FRESH WAL connection, ensure the schema, run `fn`, then CLOSE it.
   *  Open-write-close per transition mirrors the real Codex CLI (and the
   *  pre-mock-agent fixture): each close checkpoints and recreates the `-wal`, a
   *  reliable WAL-frame fs event for the provider's watcher on every platform.
   *  (The darwin root cause was NOT here — it was the scenario cwd living under
   *  `/tmp`, which realpath-diverges from the padi's tracked cwd; see the
   *  `cdIntoScenarioDir` comment in mockAgent.ts.) */
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
    this.writeArtifacts(state, opts);
    // Replay rewrites BOTH the rollout and the DB row. Codex's session-watcher
    // short-circuits re-parse when the rollout byte size is unchanged — a
    // DB-only nudge after a dropped second-state write would leave contextTokens
    // stuck at the first parse (null). Re-writing the rollout keeps size/content
    // in sync with the current state so every kick re-derives.
    this.replay = () => this.writeArtifacts(state, opts);
  }

  private writeArtifacts(state: AgentState, opts: StateOpts): void {
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

  nudge(): void {
    // Re-fire the last write. bin.ts calls this on a cadence tighter than the
    // provider's poll (> the 150ms debounce, so it never starves it) so a
    // single dropped WAL fs event under N-worker load is retried — the in-agent
    // twin of the old test-side per-poll nudge. Real Codex re-writes per turn.
    this.replay?.();
  }

  remove(): void {
    if (!this.wrote) {
      this.replay = null;
      return;
    }
    // Row-delete, not file-unlink: unlinking would break the server's WAL
    // handle. Deleting the row is its own WAL frame — the "session gone" clear.
    // Make it the new replay so bin.ts keeps re-firing the deletion for its
    // removal window (a dropped delete event can't leave the indicator wedged).
    this.replay = () =>
      this.withDb((db) => {
        db.prepare("DELETE FROM threads WHERE cwd = ?").run(this.cwd);
      });
    this.replay();
  }
}
