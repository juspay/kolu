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
  TerminalPorts,
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
    ports: inMemoryChannel<TerminalPorts>(),
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
      signals.ports.publish({ status: "known", list: ports });
      await flush();
    },
    /** A pass that could not see — distinct from one that saw nothing. */
    blind: async () => {
      signals.ports.publish({ status: "unknown" });
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
    expect(h.emitted).toEqual([
      { kind: "ports", ports: { status: "known", list: [p(8080)] } },
    ]);
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

  it("announces a successful EMPTY scan once, then goes quiet", async () => {
    // This behaviour CHANGED with the honest two-way, and the change is the point:
    // the baseline is now `unknown`, so the first successful empty scan is real
    // news — we looked, and there is nothing — rather than a no-op against a
    // fabricated `[]`. It is said once and then deduped like any other sample.
    const h = harness();
    await h.scan([]);
    await h.scan([]);
    expect(h.emitted).toEqual([
      { kind: "ports", ports: { status: "known", list: [] } },
    ]);
    h.stop();
  });

  it("emits NOTHING while the scan stays BLIND, and never claims empty", async () => {
    // The invariant the two-way exists for: a terminal whose first pass could not
    // see must not reach the snapshot as one that serves nothing.
    const h = harness();
    await h.blind();
    await h.blind();
    expect(h.emitted).toEqual([]);
    h.stop();
  });

  it("emits when blindness lifts, even onto an empty set", async () => {
    const h = harness();
    await h.blind();
    await h.scan([]);
    expect(h.emitted).toEqual([
      { kind: "ports", ports: { status: "known", list: [] } },
    ]);
    h.stop();
  });

  it("emits when a port appears, and again when it dies", async () => {
    const h = harness();
    await h.scan([p(8080)]);
    await h.scan([p(8080), p(9229)]);
    await h.scan([p(8080)]);
    await h.scan([]);
    expect(
      h.emitted.map((o) =>
        o.kind === "ports" && o.ports.status === "known" ? o.ports.list : null,
      ),
    ).toEqual([[p(8080)], [p(8080), p(9229)], [p(8080)], []]);
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
