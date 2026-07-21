/**
 * claude-code session-watcher wiring for the append-robust floor
 * (juspay/kolu#1754). The exhaustive floor mechanics live in kolu-io's
 * `file-append-watcher.test.ts`; this guards that the floor is reachable
 * THROUGH the real transcript watcher — a dropped `end_turn` edge on a fast
 * turn self-heals to `waiting`, without leaning on the (disarmed) live-thinking
 * decay path. (The narrative #1754 reproduction lives in `repro-1754/`.)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// PROJECTS_DIR is captured at module load; setting it also disables the
// summary-fetch CLI spawn. Point it at a temp dir before importing the watcher.
const projectsDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "kolu-claude-floor-"),
);
process.env.KOLU_CLAUDE_PROJECTS_DIR = projectsDir;

const { createSessionWatcher } = await import("./session-watcher.ts");
const { encodeProjectPath } = await import("./core.ts");
type ClaudeCodeInfo = import("./schemas.ts").ClaudeCodeInfo;

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof createSessionWatcher>[2];

const CWD = "/floor/cwd";
const SESSION_ID = "sess-floor";
const BASE = Date.parse("2026-07-20T00:00:00.000Z");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let transcriptPath: string;
let realWatch: typeof fs.watch;

beforeEach(() => {
  realWatch = fs.watch;
  fs.watch = (() => ({
    close: () => {},
    on() {
      return this;
    },
    ref() {
      return this;
    },
    unref() {
      return this;
    },
  })) as unknown as typeof fs.watch;
  const dir = path.join(projectsDir, encodeProjectPath(CWD));
  fs.mkdirSync(dir, { recursive: true });
  transcriptPath = path.join(dir, `${SESSION_ID}.jsonl`);
});

afterEach(() => {
  fs.watch = realWatch;
  fs.rmSync(transcriptPath, { force: true });
});

const line = (o: object) => `${JSON.stringify(o)}\n`;

describe("claude watcher — append-robust floor (#1754)", () => {
  it("self-heals to `waiting` after a dropped `end_turn` edge", async () => {
    // A live (non-orphaned) trailing user prompt → `thinking`.
    fs.writeFileSync(
      transcriptPath,
      line({
        type: "user",
        timestamp: new Date(BASE + 1000).toISOString(),
        message: { role: "user", content: "quick thing" },
      }),
    );

    const states: string[] = [];
    const watcher = createSessionWatcher(
      { pid: process.pid, sessionId: SESSION_ID, cwd: CWD, startedAt: BASE },
      (info: ClaudeCodeInfo) => states.push(info.state),
      silentLog,
    );
    await sleep(50);
    expect(states.at(-1)).toBe("thinking");

    // The terminal end_turn appends after attach; its edge is dropped.
    fs.appendFileSync(
      transcriptPath,
      line({
        type: "assistant",
        timestamp: new Date(BASE + 2000).toISOString(),
        message: {
          role: "assistant",
          model: "claude-opus-4-8",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
        },
      }),
    );
    await sleep(1400); // > one poll interval

    expect(states.at(-1)).toBe("waiting");
    watcher.destroy();
  });
});
