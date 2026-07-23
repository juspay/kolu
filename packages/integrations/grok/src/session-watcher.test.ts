/**
 * Grok session-watcher regression pins:
 *
 *  - **#1754** — the append-robust floor is reachable THROUGH the real grok
 *    watcher: a dropped `turn_ended` edge on `events.jsonl` self-heals to
 *    `waiting` with no edge and no further write. Exhaustive floor mechanics
 *    live in `kolu-io`'s `file-append-watcher.test.ts`.
 *  - **#1952** — phase-spam starvation: continuous fs.watch edges faster than
 *    the quiet window still publish within maxWait (shared
 *    `createCoalesceSchedule`). Primitive-level starvation lives in
 *    `kolu-io`'s `coalesce-schedule.test.ts`; this file pins the guarantee
 *    through the real grok watcher.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";
import { DEFAULT_APPEND_POLL_MS } from "kolu-io";
import { suppressFsWatchEdges } from "kolu-io/suppress-fs-watch.testlib";
import {
  createGrokWatcher,
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MS,
  type GrokWatcher,
} from "./session-watcher.ts";

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
  it("DEBOUNCE_MAX_MS ≤ DEFAULT_APPEND_POLL_MS (documented invariant)", () => {
    expect(DEBOUNCE_MAX_MS).toBeLessThanOrEqual(DEFAULT_APPEND_POLL_MS);
    expect(DEBOUNCE_MS).toBeLessThanOrEqual(DEBOUNCE_MAX_MS);
  });
});

describe("grok watcher — append-robust floor (#1754)", () => {
  beforeEach(() => {
    // only the statSync poll floor recovers — edges suppressed
    restoreWatch = suppressFsWatchEdges();
  });

  it("self-heals to `waiting` after a dropped `turn_ended` edge", async () => {
    const session = setupSession();
    const states: GrokInfo["state"][] = [];
    watcher = createGrokWatcher(session, (i) => states.push(i.state));

    expect(states.at(-1)).toBe("thinking"); // open turn

    fs.appendFileSync(
      session.eventsPath,
      `${JSON.stringify({ type: "turn_ended" })}\n`,
    );
    await sleep(DEFAULT_APPEND_POLL_MS + 400); // > one poll interval; edge dropped

    expect(states.at(-1)).toBe("waiting");
  });

  it("picks up events.jsonl appearing after the watcher subscribes (Q7 unconditional)", async () => {
    // Session dir + summary.json exist (Grok made the session), but
    // events.jsonl hasn't been flushed yet — the old dir-watch bootstrap never
    // re-armed a file watch once it appeared (the macOS kqueue hole this PR
    // closes). Subscribe unconditionally instead and prove the floor's
    // absent→present reconcile fires with no fs.watch edge at all.
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
    // events.jsonl is absent — asserted functionally below (the initial state is
    // the missing-file `thinking` default; had the file existed with a turn
    // already ended it would read `waiting`). An `fs.existsSync` pre-check here
    // would be a redundant check-then-write on the same path — CodeQL flags that
    // as a file-system race (js/file-system-race), so we lean on the state.
    const states: GrokInfo["state"][] = [];
    watcher = createGrokWatcher(session, (i) => states.push(i.state));

    // No events.jsonl yet — deriveGrokInfo's documented missing-file default.
    expect(states.at(-1)).toBe("thinking");

    // events.jsonl appears with a turn already ended — a real state, distinct
    // from the missing-file default, so the transition is observable.
    fs.writeFileSync(eventsPath, `${JSON.stringify({ type: "turn_ended" })}\n`);
    await sleep(DEFAULT_APPEND_POLL_MS + 400); // > one poll interval

    expect(states.at(-1)).toBe("waiting");
  });
});

describe("grok watcher — debounce maxWait under phase spam (#1952)", () => {
  // Production's failure source is continuous real fs.watch edges re-arming a
  // pure trailing debounce. This test suppresses the OS edge and drives that
  // same consumer callback deterministically at the kolu-io boundary.

  it("publishes a mid-burst state change without a DEBOUNCE_MS quiet gap", async () => {
    // The OS watcher is separately covered by kolu-io. Capture its callback at
    // this consumer boundary and drive exact fake time so loaded CI cannot
    // stretch a nominal 50ms gap beyond the 150ms premise.
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

    // Mimic streaming_text / tool_execution spam by feeding the real Grok
    // schedule callback every 50ms, strictly below DEBOUNCE_MS, for longer than
    // DEBOUNCE_MAX_MS. A pure trailing debounce would still be pending.
    const line = `${JSON.stringify({ type: "phase_changed", phase: "tool_execution" })}\n`;
    const firstAppendAt = Date.now();
    fs.appendFileSync(session.eventsPath, line);
    appendCtl.callbacks[0]?.();
    for (let elapsed = 50; elapsed <= DEBOUNCE_MAX_MS + 100; elapsed += 50) {
      await vi.advanceTimersByTimeAsync(50);
      appendCtl.callbacks[0]?.();
    }

    // Flip lands exactly on maxWait from the first append — no scheduler jitter
    // or accidental quiet gap can satisfy this assertion.
    expect(flipAt).not.toBeNull();
    expect(flipAt! - firstAppendAt).toBe(DEBOUNCE_MAX_MS);
    expect(states).toContain("tool_use");
    expect(states.at(-1)).toBe("tool_use");
  });
});
