import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  DEFAULT_APPEND_POLL_MS,
} from "kolu-io";
import { suppressFsWatchEdges } from "kolu-io/suppress-fs-watch.testlib";
import { createGrokWatcher, type GrokWatcher } from "./session-watcher.ts";

const appendCtl = vi.hoisted(() => ({
  capture: false,
  callbacks: [] as Array<() => void>,
}));

vi.mock("kolu-io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("kolu-io")>();
  return {
    ...actual,
    subscribeFileAppends: (
      ...args: Parameters<typeof actual.subscribeFileAppends>
    ) => {
      if (!appendCtl.capture) return actual.subscribeFileAppends(...args);
      appendCtl.callbacks.push(args[1]);
      return () => {
        const index = appendCtl.callbacks.indexOf(args[1]);
        if (index !== -1) appendCtl.callbacks.splice(index, 1);
      };
    },
  };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmp: string;
let restoreWatch: (() => void) | null = null;
let watcher: GrokWatcher | null = null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-grok-floor-"));
  restoreWatch = null;
  watcher = null;
  appendCtl.capture = false;
  appendCtl.callbacks = [];
});

afterEach(() => {
  watcher?.destroy();
  watcher = null;
  vi.useRealTimers();
  restoreWatch?.();
  restoreWatch = null;
  appendCtl.capture = false;
  appendCtl.callbacks = [];
  fs.rmSync(tmp, { recursive: true, force: true });
});

function setupSession(): GrokSession {
  const dir = path.join(tmp, "sessions", "cwd", "sess");
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  const summaryPath = path.join(dir, "summary.json");
  fs.writeFileSync(eventsPath, `${JSON.stringify({ type: "turn_started" })}\n`);
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({
      info: { id: "sess", cwd: "/cwd" },
      current_model_id: "grok-4.5",
      generated_title: "T",
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:01.000Z",
    }),
  );
  return {
    id: "sess",
    cwd: "/cwd",
    eventsPath,
    summaryPath,
    signalsPath: path.join(dir, "signals.json"),
    startedAt: Date.parse("2026-07-20T00:00:00.000Z"),
  };
}

describe("grok watcher — shared coalesce constants", () => {
  it("COALESCE_MAX_WAIT_MS ≤ DEFAULT_APPEND_POLL_MS (documented invariant)", () => {
    expect(COALESCE_MAX_WAIT_MS).toBeLessThanOrEqual(DEFAULT_APPEND_POLL_MS);
    expect(COALESCE_DEBOUNCE_MS).toBeLessThanOrEqual(COALESCE_MAX_WAIT_MS);
  });
});

describe("grok watcher — append-robust floor (#1754)", () => {
  beforeEach(() => {
    restoreWatch = suppressFsWatchEdges();
  });

  it("self-heals to `waiting` after a dropped `turn_ended` edge", async () => {
    const session = setupSession();
    const states: GrokInfo["state"][] = [];
    watcher = createGrokWatcher(session, (i) => states.push(i.state));

    expect(states.at(-1)).toBe("thinking");

    fs.appendFileSync(
      session.eventsPath,
      `${JSON.stringify({ type: "turn_ended" })}\n`,
    );
    await sleep(DEFAULT_APPEND_POLL_MS + 400);

    expect(states.at(-1)).toBe("waiting");
  });

  it("picks up events.jsonl appearing after the watcher subscribes (Q7 unconditional)", async () => {
    const dir = path.join(tmp, "sessions", "cwd", "sess2");
    fs.mkdirSync(dir, { recursive: true });
    const eventsPath = path.join(dir, "events.jsonl");
    const summaryPath = path.join(dir, "summary.json");
    fs.writeFileSync(
      summaryPath,
      JSON.stringify({
        info: { id: "sess2", cwd: "/cwd" },
        current_model_id: "grok-4.5",
        generated_title: "T",
        created_at: "2026-07-20T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:01.000Z",
      }),
    );
    const session: GrokSession = {
      id: "sess2",
      cwd: "/cwd",
      eventsPath,
      summaryPath,
      signalsPath: path.join(dir, "signals.json"),
      startedAt: Date.parse("2026-07-20T00:00:00.000Z"),
    };
    // An `fs.existsSync` pre-check on events.jsonl here would be a
    // check-then-write on the same path — CodeQL `js/file-system-race` — so
    // the file's absence is asserted functionally below instead.
    const states: GrokInfo["state"][] = [];
    watcher = createGrokWatcher(session, (i) => states.push(i.state));

    expect(states.at(-1)).toBe("thinking");

    fs.writeFileSync(eventsPath, `${JSON.stringify({ type: "turn_ended" })}\n`);
    await sleep(DEFAULT_APPEND_POLL_MS + 400);

    expect(states.at(-1)).toBe("waiting");
  });
});

describe("grok watcher — debounce maxWait under phase spam (#1952)", () => {
  it("publishes a mid-burst state change without a quiet gap", async () => {
    restoreWatch = suppressFsWatchEdges();
    appendCtl.capture = true;
    vi.useFakeTimers();
    const session = setupSession();
    const states: GrokInfo["state"][] = [];
    let flipAt: number | null = null;
    watcher = createGrokWatcher(session, (i) => {
      if (i.state === "tool_use" && flipAt === null) flipAt = Date.now();
      states.push(i.state);
    });
    expect(states.at(-1)).toBe("thinking");
    expect(appendCtl.callbacks).toHaveLength(1);

    const line = `${JSON.stringify({ type: "phase_changed", phase: "tool_execution" })}\n`;
    const firstAppendAt = Date.now();
    fs.appendFileSync(session.eventsPath, line);
    appendCtl.callbacks[0]?.();
    for (
      let elapsed = 50;
      elapsed <= COALESCE_MAX_WAIT_MS + 100;
      elapsed += 50
    ) {
      await vi.advanceTimersByTimeAsync(50);
      appendCtl.callbacks[0]?.();
    }

    expect(flipAt).not.toBeNull();
    expect(flipAt! - firstAppendAt).toBe(COALESCE_MAX_WAIT_MS);
    expect(states).toContain("tool_use");
    expect(states.at(-1)).toBe("tool_use");
  });
});
