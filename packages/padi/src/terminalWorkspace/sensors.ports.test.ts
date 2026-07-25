/**
 * The port sensor's CHURN GUARD — the one judgment it makes.
 *
 * A 5-second scan re-derives the same port set on almost every pass. Without the
 * structural dedup, every pass would emit, and every emit walks the whole
 * publish chain: fold → registry → the `terminals` collection → the wire → a
 * SolidJS store write, per terminal, forever. So "an unchanged scan emits nothing"
 * is not an optimization, it is the condition under which a seconds-cadence sensor
 * is affordable at all.
 */

import { inMemoryChannel } from "@kolu/surface/server";
import type {
  PortInfo,
  TerminalEvent,
  TerminalId,
} from "@kolu/terminal-vocab/schema";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  type CommandRunSample,
  type SensorSignals,
  startPortSensor,
} from "./sensors.ts";

const silent = pino({ level: "silent" });

const p = (port: number, wildcard = true): PortInfo => ({
  port,
  name: "node",
  wildcard,
});

// The consume loop delivers each publish on a microtask, so a macrotask hop drains
// every queued `onEvent` before we assert.
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Drive the port channel and collect what the sensor emitted. */
function harness() {
  const signals: SensorSignals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<readonly PortInfo[]>(),
  };
  const emitted: TerminalEvent[] = [];
  const stop = startPortSensor(
    "t1" as TerminalId,
    signals,
    (o) => emitted.push(o),
    silent,
  );
  return {
    scan: async (ports: PortInfo[]) => {
      signals.ports.publish(ports);
      await flush();
    },
    emitted,
    stop,
  };
}

describe("the port sensor", () => {
  it("emits the first non-empty sample", async () => {
    const h = harness();
    await h.scan([p(8080)]);
    expect(h.emitted).toEqual([{ kind: "ports", ports: [p(8080)] }]);
    h.stop();
  });

  it("emits NOTHING for a repeated identical scan", async () => {
    const h = harness();
    await h.scan([p(8080), p(9229)]);
    await h.scan([p(8080), p(9229)]);
    await h.scan([p(8080), p(9229)]);
    expect(h.emitted).toHaveLength(1);
    h.stop();
  });

  it("says nothing at all while a terminal serves nothing", async () => {
    // The common case — most terminals never bind a port — so the empty seed must
    // match `seedSnapshot`, or every idle terminal would emit on its first scan.
    const h = harness();
    await h.scan([]);
    await h.scan([]);
    expect(h.emitted).toEqual([]);
    h.stop();
  });

  it("emits when a port appears, and again when it dies", async () => {
    const h = harness();
    await h.scan([p(8080)]);
    await h.scan([p(8080), p(9229)]);
    await h.scan([p(8080)]);
    await h.scan([]);
    expect(h.emitted.map((o) => (o.kind === "ports" ? o.ports : null))).toEqual(
      [[p(8080)], [p(8080), p(9229)], [p(8080)], []],
    );
    h.stop();
  });

  it("emits when only the BIND changes — same port, now reachable", async () => {
    // A dev server restarted with `--host` keeps its number but stops needing a
    // forward. A port-number-only comparison would leave the chip inert forever.
    const h = harness();
    await h.scan([p(5173, false)]);
    await h.scan([p(5173, true)]);
    expect(h.emitted).toHaveLength(2);
    h.stop();
  });

  it("emits when only the process NAME changes", async () => {
    const h = harness();
    await h.scan([{ port: 3000, name: "node", wildcard: true }]);
    await h.scan([{ port: 3000, name: "workerd", wildcard: true }]);
    expect(h.emitted).toHaveLength(2);
    h.stop();
  });

  it("goes quiet once stopped", async () => {
    const h = harness();
    h.stop();
    await h.scan([p(8080)]);
    expect(h.emitted).toEqual([]);
  });
});
