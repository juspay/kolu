import { inMemoryChannel } from "@kolu/surface/server";
import type {
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { ForegroundSample } from "kaval";

import type { ProcessSnapshot } from "kolu-io/types";
import pino from "pino";
import { afterEach, expect, it, vi } from "vitest";

const reads: number[] = [];
let failNextReads = 0;
vi.mock("kolu-io", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    readProcessSnapshot: (pid: number): ProcessSnapshot | null => {
      reads.push(pid);
      if (failNextReads > 0) {
        failNextReads -= 1;
        return null;
      }
      return { argv: ["omp"], env: {} };
    },
  };
});
// Dynamic, because `vi.mock` is hoisted above static imports and the sensor
// module captures `readProcessSnapshot` at import time — a static import would
// bind the real one.
const { AGENT_PLUGINS } = await import("kolu-agents");
const { startAgentSensor, freshAgentEngineState } = await import(
  "./sensors.ts"
);

const log = pino({ level: "silent" });
const SHELL_PID = 4_001;
const AGENT_PID = 4_002;

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

const sharedState = freshAgentEngineState();

function startOmpSensor() {
  const signals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<string>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
    screenSettled: inMemoryChannel<void>(),
    submitted: inMemoryChannel<void>(),
  };
  const stops = [
    startAgentSensor(
      AGENT_PLUGINS.omp.adapter,
      sharedState,
      SHELL_PID,
      "/repo",
      "T1" as TerminalId,
      signals,
      undefined,
      () => {},
      log,
      false,
      () => {},
    ),
    startAgentSensor(
      AGENT_PLUGINS.omp.adapter,
      sharedState,
      SHELL_PID,
      "/repo",
      "T1" as TerminalId,
      signals,
      undefined,
      () => {},
      log,
      false,
      () => {},
    ),
  ];
  return {
    signals,
    stop: () => {
      for (const s of stops) s();
    },
  };
}

afterEach(() => {
  reads.length = 0;
  failNextReads = 0;
});

it("reads the process snapshot ONCE per foreground sample, across adapters and reconciles", async () => {
  const h = startOmpSensor();
  reads.length = 0;

  h.signals.foreground.publish({
    process: "/usr/bin/omp",
    foregroundPid: AGENT_PID,
  });
  await flush();
  expect(reads).toEqual([AGENT_PID]);

  h.signals.title.publish("omp — building");
  h.signals.cwd.publish("/repo/sub");
  h.signals.cwd.publish("/repo");
  await flush();
  expect(reads).toEqual([AGENT_PID]);

  h.stop();
});

it("re-reads when a NEW foreground sample arrives", async () => {
  const h = startOmpSensor();
  reads.length = 0;

  h.signals.foreground.publish({
    process: "/usr/bin/omp",
    foregroundPid: AGENT_PID,
  });
  await flush();
  h.signals.foreground.publish({
    process: "/usr/bin/omp",
    foregroundPid: AGENT_PID + 1,
  });
  await flush();

  expect(reads).toEqual([AGENT_PID, AGENT_PID + 1]);
  h.stop();
});

it("does NOT cache a FAILED read — a transient /proc error costs one retry, not the run", async () => {
  const h = startOmpSensor();
  reads.length = 0;
  failNextReads = 1;

  h.signals.foreground.publish({
    process: "/usr/bin/omp",
    foregroundPid: AGENT_PID,
  });
  await flush();
  expect(reads).toEqual([AGENT_PID, AGENT_PID]);

  h.signals.title.publish("omp — building");
  await flush();
  expect(reads).toEqual([AGENT_PID, AGENT_PID]);

  h.stop();
});
