import { inMemoryChannel } from "@kolu/surface/server";
import type {
  TerminalEvent,
  TerminalGrid,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import type { AgentAdapter, AgentInfoShape } from "anyagent";
import { matchesAgent } from "anyagent";
import type { ForegroundSample } from "kaval";
import { agentCliGrammar } from "kolu-agents/vocab";
import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  freshAgentEngineState,
  type SensorSignals,
  startAgentSensor,
} from "./sensors.ts";

const log = pino({ level: "silent" });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const ROOT_PID = 4321;
const AGENT_INFO: AgentInfoShape = {
  kind: "opencode",
  state: "thinking",
  sessionId: "S1",
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
};

function startHarness(commandRooted: boolean) {
  const emits: TerminalEvent[] = [];
  const adapter: AgentAdapter<number, AgentInfoShape> = {
    kind: "opencode",
    resolveSessions: (state) =>
      matchesAgent(state, agentCliGrammar("opencode")) ? [ROOT_PID] : [],
    sessionKey: (s) => String(s),
    sessionStartedAt: () => null,
    createWatcher: (_s, onChange) => {
      onChange(AGENT_INFO);
      return { destroy() {} };
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
    submitted: inMemoryChannel<void>(),
  };
  const stop = startAgentSensor(
    adapter,
    { ...freshAgentEngineState(), currentAgent: "opencode" },
    ROOT_PID,
    "/w",
    "t1" as TerminalId,
    signals,
    undefined,
    (o) => emits.push(o),
    log,
    commandRooted,
    () => {},
  );
  return { emits, signals, stop };
}

const lastAgent = (emits: TerminalEvent[]) =>
  emits.filter((e) => e.kind === "agent").at(-1);

describe("command-rooted agent detection (#1872 lock 2 — shellIdle discrimination)", () => {
  it("resolves a command-rooted shim agent whose root is in the foreground", async () => {
    const h = startHarness(true);
    h.signals.foreground.publish({ process: "node", foregroundPid: ROOT_PID });
    await flush();
    const agent = lastAgent(h.emits);
    expect(agent).toBeDefined();
    expect(agent?.agent).not.toBe(null);
    h.stop();
  });

  it("a shell-rooted PTY still reads foreground==root as an idle prompt", async () => {
    const h = startHarness(false);
    h.signals.foreground.publish({ process: "node", foregroundPid: ROOT_PID });
    await flush();
    expect(lastAgent(h.emits)?.agent ?? null).toBe(null);
    h.stop();
  });
});
