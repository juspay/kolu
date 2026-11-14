/**
 * PRESENCE — an agent is here before it has a session. Driven through the real
 * `startAgentSensor` with a fake omp-shaped adapter whose session store the test
 * controls, so the three facts a presence is made of can be moved one at a time:
 * the foreground program (the process fact), the host's screen-settled report
 * (`starting` → `fresh`), and the agent's session (named before its transcript
 * lands, then refined by the watcher's first value).
 */

import { inMemoryChannel } from "@kolu/surface/server";
import type {
  AgentInfo,
  TerminalEvent,
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { AgentAdapter, AgentInfoShape } from "anyagent";
import type { ForegroundSample } from "kaval";
import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  freshAgentEngineState,
  type SensorSignals,
  startAgentSensor,
} from "./sensors.ts";

const log = pino({ level: "silent" });

const SHELL_PID = 100;
const AGENT_PID = 999;

const flush = () => new Promise((resolve) => setImmediate(resolve));

const shell: ForegroundSample = { process: "bash", foregroundPid: SHELL_PID };
const omp = (pid = AGENT_PID): ForegroundSample => ({
  process: "omp",
  foregroundPid: pid,
});

/** The session the fake store offers once omp has "written its crumb". */
const SESSION = "0190-session";
/** A FINISHED conversation an earlier omp left on this tty — its crumb is
 *  still there, and its transcript reads at once. */
const OLD_SESSION = "0180-old-session";

const sessionInfo = (
  sessionId: string,
  state: "thinking" | "waiting",
): AgentInfoShape => ({
  kind: "omp",
  state,
  sessionId,
  model: "m",
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
});

function startHarness() {
  const emits: TerminalEvent[] = [];
  let crumb: string | null = null;
  let land: ((info: AgentInfoShape) => void) | null = null;
  const adapter: AgentAdapter<string, AgentInfoShape> = {
    kind: "omp",
    resolveSessions: (state) =>
      crumb !== null && state.readForegroundBasename() === "omp" ? [crumb] : [],
    sessionKey: (s) => s,
    sessionStartedAt: () => null,
    presenceSessionId: (s) => s,
    // The old conversation's transcript reads at once; the new one is lazy —
    // the watcher has nothing to read until the test says the transcript
    // landed.
    createWatcher: (s, onChange) => {
      if (s === OLD_SESSION) onChange(sessionInfo(OLD_SESSION, "waiting"));
      else land = onChange;
      return {
        destroy() {
          land = null;
        },
      };
    },
  };
  const signals: SensorSignals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<string>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
    grid: inMemoryChannel<TerminalGrid>(),
    screenSettled: inMemoryChannel<void>(),
  };
  const stop = startAgentSensor(
    adapter,
    freshAgentEngineState(),
    SHELL_PID,
    "/w",
    "term-1" as TerminalId,
    signals,
    undefined,
    (o) => emits.push(o),
    log,
    false,
  );
  let titles = 0;
  return {
    /** The agent value the record would hold now — the last authoritative one. */
    agent(): AgentInfo | null | "none-yet" {
      const last = emits
        .filter((e) => e.kind === "agent" && e.agent !== "unknown")
        .at(-1);
      if (
        last === undefined ||
        last.kind !== "agent" ||
        last.agent === "unknown"
      )
        return "none-yet";
      return last.agent.value?.info ?? null;
    },
    async foreground(sample: ForegroundSample) {
      signals.foreground.publish(sample);
      await flush();
    },
    async settled() {
      signals.screenSettled.publish();
      await flush();
    },
    async writeCrumb(session = SESSION) {
      crumb = session;
      signals.title.publish(`t${titles++}`);
      await flush();
    },
    landTranscript(info: AgentInfoShape) {
      if (land === null) throw new Error("no watcher to land a transcript on");
      land(info);
    },
    stop,
  };
}

describe("an agent is present from its foreground alone", () => {
  it("is `starting` the moment its binary is in front, with no session", async () => {
    const h = startHarness();
    await h.foreground(shell);
    expect(h.agent()).toBe("none-yet");
    await h.foreground(omp());
    expect(h.agent()).toMatchObject({
      kind: "omp",
      state: "starting",
      sessionId: null,
      model: null,
    });
    h.stop();
  });

  it("moves to `fresh` when the host reports its screen settled", async () => {
    const h = startHarness();
    await h.foreground(omp());
    await h.settled();
    expect(h.agent()).toMatchObject({ kind: "omp", state: "fresh" });
    h.stop();
  });

  it("a settle belongs to the process that settled: a new agent process starts over", async () => {
    const h = startHarness();
    await h.foreground(omp(AGENT_PID));
    await h.settled();
    await h.foreground(shell);
    expect(h.agent()).toBeNull();
    await h.foreground(omp(AGENT_PID + 1));
    expect(h.agent()).toMatchObject({ state: "starting" });
    h.stop();
  });

  it("ends when the agent leaves the foreground for the shell", async () => {
    const h = startHarness();
    await h.foreground(omp());
    await h.settled();
    await h.foreground(shell);
    expect(h.agent()).toBeNull();
    h.stop();
  });

  it("is never claimed by an agent whose binary is not in front", async () => {
    const h = startHarness();
    await h.foreground({ process: "vim", foregroundPid: AGENT_PID });
    expect(h.agent()).toBe("none-yet");
    h.stop();
  });
});

describe("a session named before its transcript", () => {
  it("carries the id the agent names, keeps its settled state, and gives way to the watcher's first value", async () => {
    const h = startHarness();
    await h.foreground(omp());
    await h.settled();
    await h.writeCrumb();
    expect(h.agent()).toMatchObject({
      kind: "omp",
      state: "fresh",
      sessionId: SESSION,
    });
    h.landTranscript(sessionInfo(SESSION, "thinking"));
    expect(h.agent()).toMatchObject({ state: "thinking", sessionId: SESSION });
    h.stop();
  });

  it("a new agent on a reused tty is not mistaken for the finished conversation an earlier one left there", async () => {
    const h = startHarness();
    // The earlier omp's crumb is still on this tty and its transcript reads at
    // once: for a beat, the new omp looks like that finished conversation.
    await h.writeCrumb(OLD_SESSION);
    await h.foreground(omp());
    expect(h.agent()).toMatchObject({
      state: "waiting",
      sessionId: OLD_SESSION,
    });
    // Then it writes its own `fresh` crumb, whose transcript is not there yet.
    await h.writeCrumb(SESSION);
    expect(h.agent()).toMatchObject({
      kind: "omp",
      state: "starting",
      sessionId: SESSION,
    });
    h.stop();
  });
});
