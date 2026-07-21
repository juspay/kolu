/**
 * grok session-watcher wiring for the append-robust floor (juspay/kolu#1754).
 *
 * The exhaustive floor mechanics live in kolu-io's
 * `file-append-watcher.test.ts`; this is the CI regression guard that the floor
 * is actually reachable THROUGH the real grok watcher — a dropped `turn_ended`
 * edge on `events.jsonl` self-heals to `waiting` with no edge and no further
 * write. (The narrative #1754 reproduction lives in `repro-1754/`.)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";
import { createGrokWatcher } from "./session-watcher.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let tmp: string;
let realWatch: typeof fs.watch;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-grok-floor-"));
  realWatch = fs.watch;
  // Drop every fs.watch edge so only the fs.watchFile floor can recover.
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
});

afterEach(() => {
  fs.watch = realWatch;
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
    await sleep(1400); // > one poll interval; edge dropped

    expect(states.at(-1)).toBe("waiting");
    watcher.destroy();
  });
});
