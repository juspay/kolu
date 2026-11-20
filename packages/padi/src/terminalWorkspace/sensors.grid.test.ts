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
import { type SensorSignals, startGridSensor } from "./sensors.ts";

const silent = pino({ level: "silent" });

const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
  const signals: SensorSignals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<string>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
    screenSettled: inMemoryChannel<void>(),
    submitted: inMemoryChannel<void>(),
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
    const h = harness();
    await h.resized(120, 40);
    await h.resized(120, 40);
    await h.resized(120, 40);
    expect(h.emitted).toHaveLength(1);
    h.stop();
  });

  it("emits on a change in EITHER dimension", async () => {
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
    const h = harness();
    await h.resized(120, 40);
    await h.resized(80, 24);
    await h.resized(120, 40);
    expect(h.emitted).toHaveLength(3);
    h.stop();
  });
});
