/**
 * Grok Build artifacts, written by the mock-agent AS the agent — the same
 * on-disk shapes real Grok writes under `~/.grok`:
 *  - `active_sessions.json` — live pid→session map
 *  - `sessions/<urlencode(cwd)>/<uuid>/events.jsonl` — phase + turn stream
 *  - `sessions/<urlencode(cwd)>/<uuid>/summary.json` — model, title, timestamps
 *  - `sessions/<urlencode(cwd)>/<uuid>/signals.json` — contextTokensUsed (opt)
 *
 * The padi's grok adapter matches via `active_sessions` pid (or falls back to
 * latest under the cwd-encoded dir when pid is unknown). Write order is
 * data-before-trigger: session tree first, then the active_sessions map (so a
 * rewake on the map never races an empty session dir).
 */

import {
  mkdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { grokDir } from "./paths.ts";
import type { AgentState, MockKind, StateOpts } from "./protocol.ts";

/** Fixed uuidv7-shaped id so summary/startedAt paths stay deterministic across
 *  scenarios (and match the shape real Grok emits). */
const SESSION_ID = "00000000-0000-7000-8000-000000000001";

function buildEvents(state: AgentState): string {
  const lines: object[] = [
    {
      ts: "2026-07-09T15:00:00.000Z",
      type: "turn_started",
      session_id: SESSION_ID,
      turn_number: 0,
      model_id: "grok-4.5",
    },
  ];
  switch (state) {
    case "thinking":
      lines.push({
        ts: "2026-07-09T15:00:01.000Z",
        type: "phase_changed",
        phase: "streaming_reasoning",
      });
      break;
    case "tool_use":
      lines.push({
        ts: "2026-07-09T15:00:01.000Z",
        type: "phase_changed",
        phase: "tool_execution",
      });
      break;
    case "awaiting_user":
      // Real ask_user_question flow: tool opens under tool_execution after
      // a flash permission auto-allow — not a stuck permission_prompt.
      lines.push({
        ts: "2026-07-09T15:00:01.000Z",
        type: "phase_changed",
        phase: "tool_execution",
      });
      lines.push({
        ts: "2026-07-09T15:00:01.001Z",
        type: "tool_started",
        tool_name: "ask_user_question",
      });
      lines.push({
        ts: "2026-07-09T15:00:01.002Z",
        type: "phase_changed",
        phase: "permission_prompt",
      });
      lines.push({
        ts: "2026-07-09T15:00:01.003Z",
        type: "permission_resolved",
        tool_name: "ask_user_question",
        decision: "allow",
        wait_ms: 0,
      });
      lines.push({
        ts: "2026-07-09T15:00:01.004Z",
        type: "phase_changed",
        phase: "tool_execution",
      });
      break;
    case "waiting":
      lines.push({
        ts: "2026-07-09T15:00:01.000Z",
        type: "phase_changed",
        phase: "streaming_text",
      });
      lines.push({
        ts: "2026-07-09T15:00:02.000Z",
        type: "turn_ended",
        outcome: "completed",
      });
      break;
    default:
      // Claude-only artifact variants collapse to thinking for Grok (the
      // product schema only knows the four lifecycle states).
      lines.push({
        ts: "2026-07-09T15:00:01.000Z",
        type: "phase_changed",
        phase: "streaming_reasoning",
      });
      break;
  }
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

export class GrokAgent implements MockKind {
  private readonly dir = grokDir();
  private readonly cwd = process.cwd();
  private readonly sessionId = SESSION_ID;
  private readonly sessionDir = join(
    this.dir,
    "sessions",
    encodeURIComponent(this.cwd),
    this.sessionId,
  );
  private readonly eventsPath = join(this.sessionDir, "events.jsonl");
  private readonly summaryPath = join(this.sessionDir, "summary.json");
  private readonly signalsPath = join(this.sessionDir, "signals.json");
  private readonly activeSessionsPath = join(this.dir, "active_sessions.json");
  private wrote = false;
  private replay: (() => void) | null = null;

  setState(state: AgentState, opts: StateOpts): void {
    this.writeAll(state, opts);
    this.replay = () => this.writeAll(state, opts);
  }

  private writeAll(state: AgentState, opts: StateOpts): void {
    mkdirSync(this.sessionDir, { recursive: true });
    // Session tree FIRST (data), active_sessions LAST (trigger) — a rewake on
    // the map never races an empty session dir.
    writeFileSync(this.eventsPath, buildEvents(state));
    writeFileSync(
      this.summaryPath,
      JSON.stringify({
        info: { id: this.sessionId, cwd: this.cwd },
        current_model_id: "grok-4.5",
        generated_title: opts.title ?? "Mock Grok session",
        created_at: "2026-07-09T15:00:00.000Z",
        updated_at: new Date().toISOString(),
      }),
    );
    if (opts.contextTokens !== undefined) {
      writeFileSync(
        this.signalsPath,
        JSON.stringify({ contextTokensUsed: opts.contextTokens }),
      );
    }
    this.writeActiveSessions(opts.noActive === true);
    this.wrote = true;
  }

  private writeActiveSessions(empty: boolean): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      this.activeSessionsPath,
      empty
        ? "[]"
        : JSON.stringify([
            {
              session_id: this.sessionId,
              pid: process.pid,
              cwd: this.cwd,
              opened_at: "2026-07-09T15:00:00.000Z",
            },
          ]),
    );
  }

  nudge(): void {
    // Re-fire the last write (content + active_sessions). bin.ts's cadence
    // retries a dropped fs event the same way the other agents do.
    if (this.replay) {
      this.replay();
      return;
    }
    if (!this.wrote) return;
    // Post-remove path: keep poking so a dropped delete can't leave the
    // indicator wedged.
    try {
      const now = new Date();
      utimesSync(this.activeSessionsPath, now, now);
    } catch {
      /* gone */
    }
  }

  remove(): void {
    if (!this.wrote) {
      this.replay = null;
      return;
    }
    // Clear the pid map first (indicator drops on active_sessions rewake),
    // then drop the session tree. Replay keeps re-firing the empty map.
    this.replay = () => {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.activeSessionsPath, "[]");
      try {
        rmSync(this.sessionDir, { recursive: true, force: true });
      } catch {
        /* already gone */
      }
    };
    this.replay();
    // Best-effort: if nothing else holds the dir, remove active_sessions too
    // so a subsequent scenario starts clean under the same HOME.
    try {
      unlinkSync(this.activeSessionsPath);
    } catch {
      /* ok */
    }
  }
}
