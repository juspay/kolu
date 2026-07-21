/**
 * #1754 Half-2 fix proof — grok watcher SELF-HEALS on a fast turn.
 *
 * This file first *reproduced* the bug (git history) and now proves the FIX,
 * inverted per the design-gate ruling. The scenario is unchanged — the watcher
 * attaches while the turn is open (`turn_started` → `thinking`), then the
 * terminal `turn_ended` append lands AFTER attach and its `fs.watch` edge is
 * DROPPED (the shim never fires it), modeling exactly the macOS-kqueue coalesce
 * that stranded grok forever (grok has no decay timer of its own).
 *
 * With the append-robust floor (`subscribeFileAppends`), the real `fs.watchFile`
 * poll re-reads the file within one interval even though no edge arrived, so the
 * state reconciles to `waiting` on its own — NO manual edge, NO further write.
 * The shim suppresses only `fs.watch` (the edge); `fs.watchFile` (the floor) is
 * real, so this drives the true recovery path end-to-end.
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

describe("#1754 Half 2 — grok self-heals a dropped `turn_ended` edge", () => {
  it("reconciles to `waiting` via the floor after a dropped edge (no manual edge)", async () => {
    const session = setupSession();
    const states: GrokInfo["state"][] = [];
    const watcher = createGrokWatcher(session, (info) =>
      states.push(info.state),
    );

    // 1) Attach-time emit: the open turn reads as `thinking`.
    expect(states.at(-1)).toBe("thinking");

    // 2) FAST TURN: the terminal completion appends AFTER attach.
    appendEvent(session.eventsPath, { type: "turn_ended" });

    // 3) DROP the edge — the shim never delivers the fs.watch callback (the
    //    coalesced / missed notification). Pre-fix this stranded `thinking`
    //    forever; now the fs.watchFile floor re-reads on its own cadence.
    //    Wait past one poll interval (DEFAULT_APPEND_POLL_MS = 1000 ms).
    await sleep(1400);

    // FIXED: the floor recovered the missed append with NO edge and NO further
    // write — the exact strand is gone.
    expect(states.at(-1)).toBe("waiting");
    // The shim proves the edge never fired — recovery was the floor's doing.
    expect(shim.forSuffix("events.jsonl").length).toBeGreaterThan(0);

    watcher.destroy();
  });
});
