/**
 * #1754 EVIDENCE — narrated live self-heal, driving the REAL grok watcher.
 *
 * This is the terminal-video artifact for PR #1914: it prints the actual state
 * transition as it happens so a recording SHOWS the sequence, not just a green
 * check. The `fs.watch` edge is suppressed (the dropped/coalesced notification
 * that is #1754); only the real `statSync` poll floor can recover — and it does,
 * reconciling `thinking → waiting` with no edge and no further write.
 *
 * Run: node_modules/.bin/vitest run repro-1754/evidence-selfheal.test.ts --reporter=basic
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGrokWatcher } from "../packages/integrations/grok/src/session-watcher.ts";
import type { GrokSession } from "../packages/integrations/grok/src/core.ts";
import { installFsWatchShim, sleep, type FsWatchShim } from "./fswatch-shim.ts";

let tmp: string;
let shim: FsWatchShim;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-1754-"));
  shim = installFsWatchShim(); // the OS drops every fs.watch edge (macOS kqueue class)
});
afterEach(() => {
  shim.uninstall();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function grokSession(): GrokSession {
  const dir = path.join(tmp, "sessions", "cwd", "sess");
  fs.mkdirSync(dir, { recursive: true });
  const eventsPath = path.join(dir, "events.jsonl");
  fs.writeFileSync(eventsPath, `${JSON.stringify({ type: "turn_started" })}\n`);
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify({
      info: { id: "sess", cwd: "/cwd" },
      current_model_id: "grok-4.5",
      generated_title: "Fast turn",
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:01.000Z",
    }),
  );
  return {
    id: "sess",
    cwd: "/cwd",
    eventsPath,
    summaryPath: path.join(dir, "summary.json"),
    signalsPath: path.join(dir, "signals.json"),
    startedAt: Date.parse("2026-07-20T00:00:00.000Z"),
  };
}

describe("#1754 self-heal (grok, real watcher, edge dropped)", () => {
  it("thinking → [dropped edge] → statSync poll floor → waiting", async () => {
    const t0 = Date.now();
    const log = (m: string) =>
      console.log(`  [t=${String(Date.now() - t0).padStart(4)}ms] ${m}`);

    const session = grokSession();
    const states: string[] = [];
    const watcher = createGrokWatcher(session, (i) => {
      states.push(i.state);
      log(`onChange fired  →  state = ${i.state.toUpperCase()}`);
    });

    log(
      `open turn observed        →  state = ${states.at(-1)?.toUpperCase()}   (the fast turn is running)`,
    );
    log(
      `terminal 'turn_ended' appended  →  fs.watch EDGE DROPPED (the shim delivers no callback)`,
    );
    fs.appendFileSync(
      session.eventsPath,
      `${JSON.stringify({ type: "turn_ended" })}\n`,
    );
    log(
      `...turn is over, agent idle, NO further write. Pre-fix: stranded 'thinking' forever.`,
    );
    log(`...waiting on the statSync poll floor (interval = 1000ms)...`);

    await sleep(1400);

    log(
      `state = ${states.at(-1)?.toUpperCase()}   ←  RECONCILED, with no edge and no further write`,
    );
    expect(states.at(-1)).toBe("waiting");
    // Prove the edge never fired — recovery was purely the poll floor.
    expect(shim.forSuffix("events.jsonl").length).toBeGreaterThan(0);
    log(
      `✓ SELF-HEAL VERIFIED — the #1754 strand is gone (poll floor recovered the dropped edge)`,
    );

    watcher.destroy();
  });
});
