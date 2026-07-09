/**
 * Fixture builders for Grok mock e2e tests.
 *
 * Real Grok Build writes `active_sessions.json` + per-session
 * `events.jsonl` / `summary.json` under `~/.grok` (or `KOLU_GROK_DIR`).
 * These helpers synthesize the same on-disk artefacts so e2e scenarios
 * can drive the Grok adapter without the real CLI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentLifecycleState } from "./agent-lifecycle.ts";

const SESSION_ID = "00000000-0000-7000-8000-000000000001";

/** Map lifecycle state → events.jsonl content. */
export function buildGrokEvents(state: AgentLifecycleState): string {
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
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
    }
  }
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

export interface GrokFixture {
  grokDir: string;
  cwd: string;
  sessionId: string;
  eventsPath: string;
  summaryPath: string;
  activeSessionsPath: string;
}

/** Create a Grok session tree under `grokDir` for `cwd`. */
export function writeGrokFixture(opts: {
  grokDir: string;
  cwd: string;
  state: AgentLifecycleState;
  pid?: number;
  title?: string;
  model?: string;
}): GrokFixture {
  const sessionId = SESSION_ID;
  const enc = encodeURIComponent(opts.cwd);
  const sessionDir = path.join(opts.grokDir, "sessions", enc, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const summaryPath = path.join(sessionDir, "summary.json");
  fs.writeFileSync(eventsPath, buildGrokEvents(opts.state));
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({
      info: { id: sessionId, cwd: opts.cwd },
      current_model_id: opts.model ?? "grok-4.5",
      generated_title: opts.title ?? "Mock Grok session",
      created_at: "2026-07-09T15:00:00.000Z",
      updated_at: "2026-07-09T15:00:02.000Z",
    }),
  );
  const activeSessionsPath = path.join(opts.grokDir, "active_sessions.json");
  // Always write (never existsSync→write): CodeQL js/file-system-race, and
  // test fixtures own this path exclusively so overwrite is correct.
  fs.writeFileSync(
    activeSessionsPath,
    opts.pid === undefined
      ? "[]"
      : JSON.stringify([
          {
            session_id: sessionId,
            pid: opts.pid,
            cwd: opts.cwd,
            opened_at: "2026-07-09T15:00:00.000Z",
          },
        ]),
  );
  return {
    grokDir: opts.grokDir,
    cwd: opts.cwd,
    sessionId,
    eventsPath,
    summaryPath,
    activeSessionsPath,
  };
}

/** Rewrite events.jsonl (and optionally active_sessions) for a state transition. */
export function updateGrokFixture(
  fixture: GrokFixture,
  opts: { state: AgentLifecycleState; pid?: number },
): void {
  fs.writeFileSync(fixture.eventsPath, buildGrokEvents(opts.state));
  // Touch summary so mtime-based fallbacks refresh.
  const summary = JSON.parse(fs.readFileSync(fixture.summaryPath, "utf8"));
  summary.updated_at = new Date().toISOString();
  fs.writeFileSync(fixture.summaryPath, JSON.stringify(summary));
  if (opts.pid !== undefined) {
    fs.writeFileSync(
      fixture.activeSessionsPath,
      JSON.stringify([
        {
          session_id: fixture.sessionId,
          pid: opts.pid,
          cwd: fixture.cwd,
          opened_at: "2026-07-09T15:00:00.000Z",
        },
      ]),
    );
  }
}
