/**
 * #1754 Half-2 repro — grok watcher strands `thinking` on a fast turn.
 *
 * Failure mode (coordinator's "Half 2 — append-after-attach, coalesced/missed
 * re-read"): the watcher attaches while the turn is open (`turn_started` →
 * `thinking`), then the terminal `turn_ended` append lands AFTER attach. On a
 * fast turn the OS coalesces / drops that append's fs.watch edge, and because
 * the grok watcher is *purely edge-triggered* (no poll / re-stat fallback, and
 * unlike claude no decay timer at all), nothing ever re-reads the file. The
 * indicator strands on `thinking` forever.
 *
 * This is NOT Half 1 (attach-after-write): the file on disk carries the
 * terminal `turn_ended`, and the watcher's own 128 KB tail read WOULD derive
 * `waiting` from it — proven by the final step, which fires a single edge and
 * watches the SAME bytes flip to `waiting`. The only thing standing between
 * stranded and correct is one fs.watch notification the OS is permitted to
 * drop.
 *
 * Run: node_modules/.bin/vitest run repro-1754/grok-half2.test.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGrokWatcher } from "../packages/integrations/grok/src/session-watcher.ts";
import type { GrokSession } from "../packages/integrations/grok/src/core.ts";
import type { GrokInfo } from "../packages/integrations/grok/src/schemas.ts";
import { installFsWatchShim, sleep, type FsWatchShim } from "./fswatch-shim.ts";

let tmp: string;
let shim: FsWatchShim;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repro-1754-grok-"));
  shim = installFsWatchShim();
});

afterEach(() => {
  shim.uninstall();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeEvents(eventsPath: string, events: object[]): void {
  fs.writeFileSync(
    eventsPath,
    events.length === 0
      ? ""
      : `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
}

function appendEvent(eventsPath: string, event: object): void {
  fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
}

function setupSession(): GrokSession {
  const sessionDir = path.join(tmp, "sessions", "cwd", "sess-1754");
  fs.mkdirSync(sessionDir, { recursive: true });
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const summaryPath = path.join(sessionDir, "summary.json");
  const signalsPath = path.join(sessionDir, "signals.json");

  // Open turn: watcher attaches here → derives `thinking`.
  writeEvents(eventsPath, [
    { type: "turn_started" },
    { type: "phase_changed", phase: "streaming_text" },
  ]);
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({
      info: { id: "sess-1754", cwd: "/cwd" },
      current_model_id: "grok-4.5",
      generated_title: "Fast turn repro",
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:01.000Z",
    }),
  );

  return {
    id: "sess-1754",
    cwd: "/cwd",
    eventsPath,
    summaryPath,
    signalsPath,
    startedAt: Date.parse("2026-07-20T00:00:00.000Z"),
  };
}

describe("#1754 Half 2 — grok stranded `thinking` on a fast turn", () => {
  it("strands `thinking` when the terminal `turn_ended` edge is dropped", async () => {
    const session = setupSession();
    const states: GrokInfo["state"][] = [];
    const watcher = createGrokWatcher(session, (info) =>
      states.push(info.state),
    );

    // 1) Attach-time emit: the open turn reads as `thinking`.
    expect(states.at(-1)).toBe("thinking");

    // 2) FAST TURN: the terminal completion appends AFTER attach.
    appendEvent(session.eventsPath, { type: "turn_ended" });

    // 3) DROP the edge — model the coalesced / missed fs.watch notification
    //    (no callback delivered). Wait well past the 150 ms debounce; grok has
    //    no other timer, so nothing else can fire.
    await sleep(500);

    // BUG: the state is stranded on `thinking` though the turn ended long ago.
    expect(states.at(-1)).toBe("thinking");
    expect(states).not.toContain("waiting");

    // 4) Prove it is Half 2, not Half 1: the SAME on-disk bytes, read via the
    //    watcher's own tail path, derive `waiting` the instant a single edge is
    //    delivered. The file was correct all along; only the notification was
    //    missing.
    const delivered = shim.fireSuffix("events.jsonl");
    expect(delivered).toBeGreaterThan(0);
    await sleep(300); // debounce + margin

    expect(states.at(-1)).toBe("waiting");

    watcher.destroy();
  });
});
