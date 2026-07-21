/**
 * grok session-watcher wiring for the append-robust floor (juspay/kolu#1754).
 *
 * The exhaustive floor mechanics live in kolu-io's
 * `file-append-watcher.test.ts`; this is the CI regression guard that the floor
 * is actually reachable THROUGH the real grok watcher — a dropped `turn_ended`
 * edge on `events.jsonl` self-heals to `waiting` with no edge and no further
 * write.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";
import { DEFAULT_APPEND_POLL_MS } from "kolu-io";
import { suppressFsWatchEdges } from "kolu-io/suppress-fs-watch.testlib";
import { createGrokWatcher } from "./session-watcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmp: string;
let restoreWatch: () => void;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-grok-floor-"));
  restoreWatch = suppressFsWatchEdges(); // only the statSync poll floor recovers
});

afterEach(() => {
  restoreWatch();
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

describe("grok watcher — append-robust floor (#1754)", () => {
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
