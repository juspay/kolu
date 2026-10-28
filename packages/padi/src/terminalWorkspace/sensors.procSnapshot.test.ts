/**
 * The per-SAMPLE process snapshot (juspay/kolu#2286).
 *
 * `readProcessSnapshot` reads `/proc/<pid>/cmdline` AND the whole of
 * `/proc/<pid>/environ`, splitting the latter into a fresh object — and before
 * this it ran once per ADAPTER per RECONCILE, with seven adapters per terminal
 * and reconciles on every title / cwd / foreground event plus four settle
 * delays after each command mark. The profile put the reconcile path at 16% of
 * a 16-terminal padi's busy time.
 *
 * The invariant: a foreground SAMPLE is read at most once, however many
 * reconciles and however many adapters that one sample survives — and a NEW
 * sample is a new read, because it names a (possibly) new pid.
 */

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
/** How many of the next reads answer `null` — the shape of a transient `/proc`
 *  failure, which must never be remembered for the life of a sample. */
let failNextReads = 0;
vi.mock("kolu-io", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    readProcessSnapshot: (pid: number): ProcessSnapshot | null => {
      reads.push(pid);
      if (failNextReads > 0) {
        failNextReads -= 1;
        return null; // what EVERY failure folds to: exited, hidepid, EACCES…
      }
      // An omp invocation with no flags: the adapter folds it to the default
      // agent dir and then finds no breadcrumb, which is all this test needs —
      // the assertion is on the READ COUNT, not the resolution.
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

/** Let the channel fan-out's microtasks land. */
function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

/** One terminal's engine state, shared by both sensors below exactly as
 *  `startSensors` shares it across all seven registered adapters. */
const sharedState = freshAgentEngineState();

function startOmpSensor() {
  const signals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<{ command: string; replayed: boolean }>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
  };
  // Two sensors over ONE engine state — the production arrangement, where every
  // registered adapter shares the terminal's `AgentEngineState`. Both are the
  // omp adapter so that both actually reach the snapshot read; the memo they
  // share is the thing under test, not which agent matched.
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

  // One sample, delivered to both sensors.
  h.signals.foreground.publish({
    process: "/usr/bin/omp",
    foregroundPid: AGENT_PID,
  });
  await flush();
  expect(reads).toEqual([AGENT_PID]);

  // Three more reconciles off the SAME sample — a title change and two cwd
  // changes, six adapter passes in total. The sample has not moved, so neither
  // has the answer.
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
  // One failure, then success. A sample lasts as long as the foreground process
  // and pid hold — usually the whole agent run — so holding the `null` would
  // blind omp's agent-dir chain and pi's store resolution for all of it.
  failNextReads = 1;

  h.signals.foreground.publish({
    process: "/usr/bin/omp",
    foregroundPid: AGENT_PID,
  });
  await flush();
  expect(reads).toEqual([AGENT_PID, AGENT_PID]);

  // …and once a read succeeds it IS held: the next reconcile off the same
  // sample asks nothing.
  h.signals.title.publish("omp — building");
  await flush();
  expect(reads).toEqual([AGENT_PID, AGENT_PID]);

  h.stop();
});
