import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_APPEND_POLL_MS } from "kolu-io";
import { suppressFsWatchEdges } from "kolu-io/suppress-fs-watch.testlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
let restoreWatch: () => void;

beforeEach(() => {
  restoreWatch = suppressFsWatchEdges();
  const dir = path.join(projectsDir, encodeProjectPath(CWD));
  fs.mkdirSync(dir, { recursive: true });
  transcriptPath = path.join(dir, `${SESSION_ID}.jsonl`);
});

afterEach(() => {
  restoreWatch();
  fs.rmSync(transcriptPath, { force: true });
});

const line = (o: object) => `${JSON.stringify(o)}\n`;

describe("claude watcher — append-robust floor (#1754)", () => {
  it("self-heals to `waiting` after a dropped `end_turn` edge", async () => {
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
    await sleep(DEFAULT_APPEND_POLL_MS + 400);

    expect(states.at(-1)).toBe("waiting");
    watcher.destroy();
  });

  it("picks up a transcript that appears after the watcher subscribes (Q7 unconditional)", async () => {
    const states: string[] = [];
    const watcher = createSessionWatcher(
      { pid: process.pid, sessionId: SESSION_ID, cwd: CWD, startedAt: BASE },
      (info: ClaudeCodeInfo) => states.push(info.state),
      silentLog,
    );
    await sleep(50);
    expect(states).toEqual([]);

    fs.writeFileSync(
      transcriptPath,
      line({
        type: "user",
        timestamp: new Date(BASE + 1000).toISOString(),
        message: { role: "user", content: "quick thing" },
      }),
    );
    await sleep(DEFAULT_APPEND_POLL_MS + 400);

    expect(states.at(-1)).toBe("thinking");
    watcher.destroy();
  });
});
