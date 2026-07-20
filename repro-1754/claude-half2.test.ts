/**
 * #1754 Half-2 repro — claude-code watcher strands `thinking` on a fast turn.
 *
 * Same class as the grok repro. The transcript watcher attaches while the turn
 * is open (a trailing live `user` prompt → `thinking`), then the assistant's
 * terminal `stop_reason:"end_turn"` line appends AFTER attach. On a fast turn
 * the OS coalesces / drops that append's fs.watch edge.
 *
 * Claude DOES have a fallback timer (`decayTransientState`'s stale-recheck),
 * but it is deliberately DISARMED for a live `thinking`: a non-orphaned prompt
 * (one that postdates the running claude's `startedAt`) returns
 * `{ recheckAt: null }` — "this is a live turn, never cleared". So on the exact
 * shape a fast real turn produces, the one fallback that could rescue the state
 * does not arm, and the dropped edge strands `thinking` with no recovery.
 *
 * As with grok, the final step proves this is Half 2, not Half 1: the same
 * on-disk transcript, read via the watcher's own 256 KB tail, derives `waiting`
 * the instant a single edge is delivered.
 *
 * Run: node_modules/.bin/vitest run repro-1754/claude-half2.test.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFsWatchShim, sleep, type FsWatchShim } from "./fswatch-shim.ts";

// PROJECTS_DIR is captured at module load from KOLU_CLAUDE_PROJECTS_DIR, and
// setting it ALSO disables the summary-fetch CLI spawn (SUMMARY_FETCH_ENABLED
// is true only when both claude dir envs are unset). Point it at a temp dir,
// then import the watcher so it binds to that dir.
const projectsDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "repro-1754-claude-projects-"),
);
process.env.KOLU_CLAUDE_PROJECTS_DIR = projectsDir;

const { createSessionWatcher } = await import(
  "../packages/integrations/claude-code/src/session-watcher.ts"
);
const { encodeProjectPath } = await import(
  "../packages/integrations/claude-code/src/core.ts"
);
type ClaudeCodeInfo =
  import("../packages/integrations/claude-code/src/schemas.ts").ClaudeCodeInfo;

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof createSessionWatcher>[2];

let shim: FsWatchShim;
let transcriptPath: string;

const CWD = "/repro/cwd";
const SESSION_ID = "sess-1754-claude";
const BASE = Date.parse("2026-07-20T00:00:00.000Z");

beforeEach(() => {
  shim = installFsWatchShim();
  const dir = path.join(projectsDir, encodeProjectPath(CWD));
  fs.mkdirSync(dir, { recursive: true });
  transcriptPath = path.join(dir, `${SESSION_ID}.jsonl`);
});

afterEach(() => {
  shim.uninstall();
  try {
    fs.rmSync(transcriptPath, { force: true });
  } catch {
    /* ignore */
  }
});

function line(obj: object): string {
  return `${JSON.stringify(obj)}\n`;
}

/** A completed prior turn, then a fresh LIVE `user` prompt (postdates
 *  startedAt) — reads as `thinking`, non-orphaned. */
function openTurnTranscript(): string {
  const priorAssistant = {
    type: "assistant",
    timestamp: new Date(BASE - 5000).toISOString(),
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "prior turn done" }],
    },
  };
  const livePrompt = {
    type: "user",
    timestamp: new Date(BASE + 1000).toISOString(), // > startedAt (BASE)
    message: { role: "user", content: "do a quick thing" },
  };
  return line(priorAssistant) + line(livePrompt);
}

/** The terminal completion append — a fast turn's `end_turn`. */
function completionLine(): string {
  return line({
    type: "assistant",
    timestamp: new Date(BASE + 2000).toISOString(),
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "done" }],
    },
  });
}

describe("#1754 Half 2 — claude-code stranded `thinking` on a fast turn", () => {
  it("strands `thinking` when the terminal `end_turn` edge is dropped", async () => {
    fs.writeFileSync(transcriptPath, openTurnTranscript());

    const states: string[] = [];
    const watcher = createSessionWatcher(
      {
        pid: process.pid, // a live pid; the thinking path never probes the subtree
        sessionId: SESSION_ID,
        cwd: CWD,
        startedAt: BASE,
      },
      (info: ClaudeCodeInfo) => states.push(info.state),
      silentLog,
    );

    // 1) Attach-time emit: the open turn reads as `thinking`.
    await sleep(50);
    expect(states.at(-1)).toBe("thinking");

    // 2) FAST TURN: the terminal `end_turn` appends AFTER attach.
    fs.appendFileSync(transcriptPath, completionLine());

    // 3) DROP the edge — model the coalesced / missed fs.watch notification.
    //    Wait past the 150 ms debounce. The stale-recheck timer is disarmed for
    //    a live `thinking`, so nothing re-derives.
    await sleep(600);

    // BUG: stranded on `thinking` though `end_turn` is on disk.
    expect(states.at(-1)).toBe("thinking");
    expect(states).not.toContain("waiting");

    // 4) Prove Half 2, not Half 1: the SAME transcript, read via the watcher's
    //    own 256 KB tail, derives `waiting` the instant one edge is delivered.
    const delivered = shim.fireSuffix(`${SESSION_ID}.jsonl`);
    expect(delivered).toBeGreaterThan(0);
    await sleep(300);

    expect(states.at(-1)).toBe("waiting");

    watcher.destroy();
  });
});
