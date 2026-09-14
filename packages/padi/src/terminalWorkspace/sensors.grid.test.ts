/**
 * The grid sensor — the record's answer to "what size is this terminal NOW?".
 *
 * It exists for the viewer that LOST last-attach-wins. Attaching is a write on a
 * shared pty, so a second viewer reflows the first underneath it, and the byte
 * stream cannot say so — a snapshot rides the initial attach and an overflow
 * re-attach, and nothing else. The losing viewer keeps painting deltas laid out
 * for a grid no frame ever named. Publishing the grid on the RECORD is what
 * makes that observable, so what these tests pin is: a real change reaches the
 * fold, and an unchanged restatement does not.
 *
 * The dedup matters for the same reason the port sensor's does — every emit
 * walks fold → registry → collection → wire → a store write, per terminal — and
 * this channel is restated far more often than it changes: EVERY attach
 * publishes the grid it was served at, including each overflow re-attach, and
 * the overwhelming majority of those restate the size the pty already had.
 */

import { inMemoryChannel } from "@kolu/surface/server";
import type {
  TerminalEvent,
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  type CommandRunSample,
  type SensorSignals,
  startGridSensor,
} from "./sensors.ts";

const silent = pino({ level: "silent" });

// The consume loop delivers each publish on a microtask, so a macrotask hop
// drains every queued `onEvent` before we assert.
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
  const signals: SensorSignals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
  };
  const emitted: TerminalEvent[] = [];
  const stop = startGridSensor(
    "t1" as TerminalId,
    signals,
    (o) => emitted.push(o),
    silent,
  );
  return {
    resized: async (cols: number, rows: number) => {
      signals.grid.publish({ cols, rows });
      await flush();
    },
    emitted,
    stop,
  };
}

describe("the grid sensor", () => {
  it("emits the first grid it is told", async () => {
    const h = harness();
    await h.resized(120, 40);
    expect(h.emitted).toEqual([
      { kind: "grid", grid: { cols: 120, rows: 40 } },
    ]);
    h.stop();
  });

  it("emits NOTHING when the same grid is restated", async () => {
    // The common case by a wide margin: every attach and every overflow
    // re-attach publishes the grid it was served at, and almost none of them
    // are a change.
    const h = harness();
    await h.resized(120, 40);
    await h.resized(120, 40);
    await h.resized(120, 40);
    expect(h.emitted).toHaveLength(1);
    h.stop();
  });

  it("emits on a change in EITHER dimension", async () => {
    // Both, separately: a height-only change (a split divider dragged
    // horizontally) reflows nothing but still moves the terminal off the size
    // the other viewer measured, and a viewer told only about width changes
    // would render rows it does not have.
    const h = harness();
    await h.resized(120, 40);
    await h.resized(80, 40);
    await h.resized(80, 24);
    expect(h.emitted).toEqual([
      { kind: "grid", grid: { cols: 120, rows: 40 } },
      { kind: "grid", grid: { cols: 80, rows: 40 } },
      { kind: "grid", grid: { cols: 80, rows: 24 } },
    ]);
    h.stop();
  });

  it("emits again when a grid returns to an EARLIER value", async () => {
    // The dedup baseline is the LAST grid published, not the set of grids ever
    // seen — two viewers ping-ponging a width is the multi-client contract's
    // own stated outcome, and each swing back is real news to the side that
    // just lost.
    const h = harness();
    await h.resized(120, 40);
    await h.resized(80, 24);
    await h.resized(120, 40);
    expect(h.emitted).toHaveLength(3);
    h.stop();
  });
});
