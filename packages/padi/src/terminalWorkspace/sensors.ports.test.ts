import { inMemoryChannel } from "@kolu/surface/server";
import type {
  PortInfo,
  PortScope,
  TerminalEvent,
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { type SensorSignals, startPortSensor } from "./sensors.ts";

const silent = pino({ level: "silent" });

const p = (
  port: number,
  scope: PortScope = "any",
  family: "v4" | "v6" = "v4",
): PortInfo => ({
  port,
  name: "node",
  command: "node server.js",
  scope,
  family,
});

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
    const h = harness();
    await h.scan([]);
    await h.scan([]);
    expect(h.emitted).toEqual([
      { kind: "ports", ports: { status: "known", list: [] } },
    ]);
    h.stop();
  });

  it("emits NOTHING while the scan stays BLIND, and never claims empty", async () => {
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
    const h = harness();
    await h.scan([p(5173, "loopback")]);
    await h.scan([p(5173, "any")]);
    expect(h.emitted).toHaveLength(2);
    h.stop();
  });

  it("emits when only the process NAME changes", async () => {
    const h = harness();
    await h.scan([
      { port: 3000, name: "node", command: "x", scope: "any", family: "v4" },
    ]);
    await h.scan([
      { port: 3000, name: "workerd", command: "x", scope: "any", family: "v4" },
    ]);
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
