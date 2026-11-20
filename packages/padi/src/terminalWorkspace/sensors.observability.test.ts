import { inMemoryChannel } from "@kolu/surface/server";
import type {
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

const AGENT_INFO: AgentInfoShape = {
  kind: "claude-code",
  state: "thinking",
  sessionId: "S1",
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  emits: TerminalEvent[];
  foreground: (sample: ForegroundSample) => Promise<void>;
  ignoranceTriggeredReconcile: () => Promise<void>;
  killSession: () => void;
  firstPasses: () => number;
  stop: () => void;
}

function startHarness(): Harness {
  const emits: TerminalEvent[] = [];
  let sessionLive = true;
  const fakeAdapter: AgentAdapter<number, AgentInfoShape> = {
    kind: "claude-code",
    resolveSessions: (state) =>
      sessionLive &&
      state.foregroundPid !== undefined &&
      state.foregroundPid !== SHELL_PID
        ? [state.foregroundPid]
        : [],
    sessionKey: (session) => String(session),
    sessionStartedAt: () => null,
    createWatcher: (_session, onChange) => {
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
  let firstPasses = 0;
  const stop = startAgentSensor(
    fakeAdapter,
    freshAgentEngineState(),
    SHELL_PID,
    "/w",
    "term-1" as TerminalId,
    signals,
    undefined,
    (o) => emits.push(o),
    log,
    false,
    () => {
      firstPasses += 1;
    },
  );
  let titles = 0;
  return {
    emits,
    foreground: async (sample) => {
      signals.foreground.publish(sample);
      await flush();
    },
    ignoranceTriggeredReconcile: async () => {
      signals.title.publish(`t${titles++}`);
      await flush();
    },
    killSession: () => {
      sessionLive = false;
    },
    firstPasses: () => firstPasses,
    stop,
  };
}

const agentEvents = (emits: TerminalEvent[]) =>
  emits.filter((e) => e.kind === "agent");

const shellSample: ForegroundSample = { process: "", foregroundPid: SHELL_PID };
const agentSample: ForegroundSample = {
  process: "claude",
  foregroundPid: AGENT_PID,
};

describe("W12 — the agent sensor's resolved-null SAMPLE-CONTENT discriminant", () => {
  it("GENUINE-QUIT: a shell-idle foreground emits an authoritative null (clears the target)", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      await h.foreground(shellSample);

      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: { value: null },
      });
    } finally {
      h.stop();
    }
  });

  it("AMBIGUOUS: a DEFINED non-shell foreground whose session is gone emits `unknown` (keep-last)", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      h.killSession();
      await h.ignoranceTriggeredReconcile();

      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });
    } finally {
      h.stop();
    }
  });

  it("BURST: any number of DEFINED non-shell resolved-nulls stay `unknown` — never an authoritative null", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      h.killSession();
      await h.foreground(agentSample);
      await h.ignoranceTriggeredReconcile();
      await h.foreground(agentSample);
      await h.ignoranceTriggeredReconcile();

      const agents = agentEvents(h.emits);
      expect(
        agents.some(
          (e) =>
            e.kind === "agent" &&
            typeof e.agent === "object" &&
            e.agent.value === null,
        ),
      ).toBe(false);
      expect(agents.at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });
    } finally {
      h.stop();
    }
  });

  it("STAYS-DEFINED-UNDER-BLINDNESS: a reconcile with NO fresh foreground sample sees the stale DEFINED pid, emits `unknown`", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      h.killSession();
      await h.ignoranceTriggeredReconcile();

      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });
    } finally {
      h.stop();
    }
  });

  it("FLAVOR-FLIP: an ambiguous `unknown` gives way to an authoritative null once the shell returns", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      h.killSession();
      await h.ignoranceTriggeredReconcile();
      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });

      await h.foreground(shellSample);
      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: { value: null },
      });
    } finally {
      h.stop();
    }
  });
});

describe("the detector's first pass — the moment padi has looked", () => {
  it("is said for a plain shell, which publishes nothing", async () => {
    const h = startHarness();
    try {
      expect(h.firstPasses()).toBe(0);
      await h.ignoranceTriggeredReconcile();
      expect(h.firstPasses()).toBe(0);
      await h.foreground(shellSample);
      expect(agentEvents(h.emits)).toEqual([]);
      expect(h.firstPasses()).toBe(1);
    } finally {
      h.stop();
    }
  });

  it("is said once, after the agent it found has been emitted", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      expect(h.firstPasses()).toBe(1);
      expect(agentEvents(h.emits)).not.toEqual([]);
      await h.foreground(shellSample);
      expect(h.firstPasses()).toBe(1);
    } finally {
      h.stop();
    }
  });

  it("waits for the screen when the question lives there — a permission prompt over a `tool_use` transcript", async () => {
    const seen: string[] = [];
    const adapter: AgentAdapter<number, AgentInfoShape> = {
      kind: "claude-code",
      resolveSessions: (state) =>
        state.foregroundPid === AGENT_PID ? [AGENT_PID] : [],
      sessionKey: (session) => String(session),
      sessionStartedAt: () => null,
      createWatcher: (_session, onChange) => {
        onChange({ ...AGENT_INFO, state: "tool_use" });
        return { destroy() {} };
      },
      screenScrape: {
        tailLines: 5,
        isPollable: (info) => info.state === "tool_use",
        promote: (info, text) =>
          text.includes("Tab to amend")
            ? { ...info, state: "awaiting_user" }
            : info,
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
      freshAgentEngineState(),
      SHELL_PID,
      "/w",
      "term-1" as TerminalId,
      signals,
      async () => " Esc to cancel · Tab to amend",
      (o) => {
        if (o.kind === "agent" && o.agent !== "unknown" && o.agent.value)
          seen.push(o.agent.value.info.state);
      },
      log,
      false,
      () => seen.push("first pass"),
    );
    try {
      signals.foreground.publish(agentSample);
      await flush();
      expect(seen).toEqual(["tool_use", "awaiting_user", "first pass"]);
      signals.foreground.publish({ ...agentSample });
      await flush();
      expect(seen.filter((s) => s === "first pass")).toHaveLength(1);
    } finally {
      stop();
    }
  });
});
