/**
 * Command-rooted agent detection (#1872, lock 2) — the shellIdle discrimination.
 *
 * For a command-rooted PTY the agent IS the root process, so its foreground pid
 * equals the spawn `pid`. `snapshotSignals` reads `foregroundPid === pid` as
 * "the shell is idle at its prompt" and force-nulls `lastAgentCommandName` — but
 * the root is not a shell, it's the agent, and foreground==root means BUSY, the
 * exact opposite. An agent whose kernel basename ≠ its name (an npm shim that
 * runs as `node`) can ONLY be matched via that command hint, so nulling it makes
 * the running agent invisible.
 *
 * Driven through the real `startAgentSensor` with a fake adapter that resolves
 * via `matchesAgent` (like the real codex / opencode adapters) — NOT the
 * pid-keyed claude path, which is shellIdle-independent and already works
 * command-rooted (see spawn-detection.feature's claude regression guard).
 */

import pino from "pino";
import type { AgentAdapter, AgentInfoShape } from "anyagent";
import { matchesAgent } from "anyagent";
import { inMemoryChannel } from "@kolu/surface/server";
import type { ForegroundSample } from "kaval";
import type {
  TerminalPorts,
  TerminalEvent,
  TerminalId,
} from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  type CommandRunSample,
  type SensorSignals,
  freshAgentEngineState,
  startAgentSensor,
} from "./sensors.ts";

const log = pino({ level: "silent" });
const flush = () => new Promise((resolve) => setImmediate(resolve));

// A command-rooted opencode under an npm shim: the agent is the PTY root, so its
// foreground pid == the spawn pid, and its kernel basename is "node". The ONLY
// signal that names it "opencode" is the command hint (seeded from the argv).
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
    commandName: "opencode",
    // Resolve via matchesAgent (command hint OR kernel basename), like the real
    // codex/opencode adapters. Here basename is "node", so it hinges on the hint.
    resolveSessions: (state) =>
      matchesAgent(state, "opencode") ? [ROOT_PID] : [],
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
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
  };
  // `currentAgent: "opencode"` models lock 1's argv seed already applied — so
  // this test isolates lock 2 (the shellIdle gate) alone. The trailing
  // `commandRooted` flag is the fix: the root IS the agent, not a shell.
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
  );
  return { emits, signals, stop };
}

const lastAgent = (emits: TerminalEvent[]) =>
  emits.filter((e) => e.kind === "agent").at(-1);

describe("command-rooted agent detection (#1872 lock 2 — shellIdle discrimination)", () => {
  it("resolves a command-rooted shim agent whose root is in the foreground", async () => {
    const h = startHarness(true);
    // Foreground == the root pid: the agent is BUSY as the PTY root (basename
    // "node"). Before lock 2 this was nulled as "shell idle"; with the
    // commandRooted flag the hint survives, matchesAgent passes, agent resolves.
    h.signals.foreground.publish({ process: "node", foregroundPid: ROOT_PID });
    await flush();
    const agent = lastAgent(h.emits);
    expect(agent).toBeDefined();
    expect(agent?.agent).not.toBe(null);
    h.stop();
  });

  it("a shell-rooted PTY still reads foreground==root as an idle prompt", async () => {
    // Regression guard: for a real shell terminal (commandRooted=false) the SAME
    // foreground==pid sample IS an idle prompt, so a stale hint must still be
    // nulled and no agent resolves. Unchanged by the fix.
    const h = startHarness(false);
    h.signals.foreground.publish({ process: "node", foregroundPid: ROOT_PID });
    await flush();
    expect(lastAgent(h.emits)?.agent ?? null).toBe(null);
    h.stop();
  });
});
