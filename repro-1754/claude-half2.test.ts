/**
 * #1754 Half-2 fix proof — claude-code watcher SELF-HEALS on a fast turn.
 *
 * Inverted from the original reproduction (git history) per the design-gate
 * ruling. The transcript watcher attaches while the turn is open (a trailing
 * live `user` prompt → `thinking`), then the assistant's terminal
 * `stop_reason:"end_turn"` line appends AFTER attach and its `fs.watch` edge is
 * DROPPED. Pre-fix this stranded `thinking` forever — claude's
 * `decayTransientState` stale-recheck is deliberately DISARMED for a live
 * (non-orphaned) `thinking` (`recheckAt: null`, "live turn, never cleared"), so
 * the one existing fallback could not rescue it.
 *
 * With the append-robust floor, the real `fs.watchFile` poll re-reads the same
 * on-disk transcript within one interval and reconciles to `waiting` — no edge,
 * no further write, and WITHOUT leaning on the disarmed decay path. The shim
 * suppresses only `fs.watch`; `fs.watchFile` is real, so this drives the true
 * recovery end-to-end.
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

describe("#1754 Half 2 — claude-code self-heals a dropped `end_turn` edge", () => {
  it("reconciles to `waiting` via the floor after a dropped edge (no manual edge)", async () => {
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

    // 3) DROP the edge — the shim never delivers the fs.watch callback. The
    //    stale-recheck timer stays disarmed for a live `thinking`, so pre-fix
    //    nothing re-derived. Wait past one poll interval (DEFAULT_APPEND_POLL_MS
    //    = 1000 ms) so the fs.watchFile floor observes the append.
    await sleep(1400);

    // FIXED: the floor re-read the same transcript and reconciled to `waiting`
    // with NO edge, NO further write, and without the disarmed decay path.
    expect(states.at(-1)).toBe("waiting");
    expect(shim.forSuffix(`${SESSION_ID}.jsonl`).length).toBeGreaterThan(0);

    watcher.destroy();
  });
});
