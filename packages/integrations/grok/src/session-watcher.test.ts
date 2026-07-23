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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";
import { DEFAULT_APPEND_POLL_MS } from "kolu-io";
import { suppressFsWatchEdges } from "kolu-io/suppress-fs-watch.testlib";
import {
  createGrokWatcher,
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MS,
} from "./session-watcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmp: string;
let restoreWatch: (() => void) | null = null;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-grok-floor-"));
  restoreWatch = null;
});

afterEach(() => {
  restoreWatch?.();
  restoreWatch = null;
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
    const watcher = createGrokWatcher(session, (i) => states.push(i.state));

    expect(states.at(-1)).toBe("thinking"); // open turn

    fs.appendFileSync(
      session.eventsPath,
      `${JSON.stringify({ type: "turn_ended" })}\n`,
    );
    await sleep(DEFAULT_APPEND_POLL_MS + 400); // > one poll interval; edge dropped

    expect(states.at(-1)).toBe("waiting");
    watcher.destroy();
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
    const watcher = createGrokWatcher(session, (i) => states.push(i.state));

    // No events.jsonl yet — deriveGrokInfo's documented missing-file default.
    expect(states.at(-1)).toBe("thinking");

    // events.jsonl appears with a turn already ended — a real state, distinct
    // from the missing-file default, so the transition is observable.
    fs.writeFileSync(eventsPath, `${JSON.stringify({ type: "turn_ended" })}\n`);
    await sleep(DEFAULT_APPEND_POLL_MS + 400); // > one poll interval

    expect(states.at(-1)).toBe("waiting");
    watcher.destroy();
  });
});

describe("grok watcher — debounce maxWait under phase spam (#1952)", () => {
  // Real fs.watch edges stay armed: Grok's live failure is continuous edges
  // re-arming a pure trailing debounce so emitIfChanged never runs mid-burst.

  it("publishes a mid-burst state change without a DEBOUNCE_MS quiet gap", async () => {
    const session = setupSession();
    const states: GrokInfo["state"][] = [];
    let flipAt: number | null = null;
    const watcher = createGrokWatcher(session, (i) => {
      if (i.state === "tool_use" && flipAt === null) flipAt = Date.now();
      states.push(i.state);
    });
    expect(states.at(-1)).toBe("thinking");

    // Mimic streaming_text / tool_execution spam: append faster than DEBOUNCE_MS
    // for longer than DEBOUNCE_MAX_MS so a pure trailing debounce would starve.
    const burstMs = DEBOUNCE_MAX_MS + DEBOUNCE_MS + 100;
    const gapMs = Math.max(10, Math.floor(DEBOUNCE_MS / 3));
    const line = `${JSON.stringify({ type: "phase_changed", phase: "tool_execution" })}\n`;
    const firstAppendAt = Date.now();
    let lastAppendAt = firstAppendAt;
    fs.appendFileSync(session.eventsPath, line);
    while (Date.now() - firstAppendAt < burstMs) {
      await sleep(gapMs);
      const now = Date.now();
      const gap = now - lastAppendAt;
      // Jitter-corrupted burst would let pure-trailing fire mid-burst and
      // false-pass the pre-fix code — fail loud instead of silent pass.
      if (gap >= DEBOUNCE_MS) {
        watcher.destroy();
        throw new Error(
          `burst inter-append gap ${gap}ms ≥ DEBOUNCE_MS ${DEBOUNCE_MS} — jitter-corrupted, not a valid #1952 run`,
        );
      }
      fs.appendFileSync(session.eventsPath, line);
      lastAppendAt = Date.now();
    }

    // Flip must land within maxWait (+slack) of the *first* append — proves
    // maxWait, not a lucky quiet gap mid-burst.
    const slackMs = 100;
    expect(flipAt).not.toBeNull();
    expect(flipAt! - firstAppendAt).toBeLessThanOrEqual(
      DEBOUNCE_MAX_MS + slackMs,
    );
    expect(states).toContain("tool_use");
    expect(states.at(-1)).toBe("tool_use");
    watcher.destroy();
  });
});
