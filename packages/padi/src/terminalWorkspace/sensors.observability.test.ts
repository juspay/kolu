/**
 * W12 producer-level regression — the resolved-null branch's OBSERVABILITY
 * discriminant, driven through the real `startAgentSensor` (a fake adapter stands
 * in for claude/codex so we control `resolveSession` off the foreground pid).
 *
 * The `fold.test.ts` "twin pins" pin the FOLD's response to `unknown` vs an
 * authoritative null; they pass even if the producer picks the wrong one. These pin
 * the PRODUCER's decision instead:
 *   - taps LIVE + no session → authoritative `{ value: null }` (a genuine end);
 *   - taps FAILED + no session → `unknown` (keep-last, so `restoreTarget` survives);
 *   - taps RECOVER (unobservable→observable) while the session is still gone → the
 *     authoritative null that the recovery must NOT swallow (F1): `current` is already
 *     null by then, so a session-key-only dedup would leave a dead agent resurrectable.
 */

import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AgentAdapter, AgentInfoShape } from "anyagent";
import { inMemoryChannel } from "@kolu/surface/server";
import type { ForegroundSample } from "kaval";
import type { TerminalEvent, TerminalId } from "@kolu/terminal-vocab/schema";
import {
  type CommandRunSample,
  type SensorSignals,
  startAgentSensor,
} from "./sensors.ts";

const log = pino({ level: "silent" });

const SHELL_PID = 100;
const AGENT_PID = 999;

// A live claude session's derived info — the watcher fires this once on match.
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

// A stand-in adapter: a foreground pid that is NOT the shell's IS the agent session
// (keyed by that pid); the shell (or an unknown foreground) resolves to no session.
const fakeAdapter: AgentAdapter<number, AgentInfoShape> = {
  kind: "claude-code",
  resolveSession: (state) =>
    state.foregroundPid !== undefined && state.foregroundPid !== SHELL_PID
      ? state.foregroundPid
      : null,
  sessionKey: (session) => String(session),
  createWatcher: (_session, onChange) => {
    onChange(AGENT_INFO);
    return { destroy() {} };
  },
};

// The consume loop delivers each publish on a microtask, so a macrotask hop drains
// every queued `onEvent` (and the reconcile it fires) before we assert.
const flush = () => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  emits: TerminalEvent[];
  setObservable: (v: boolean) => void;
  foreground: (sample: ForegroundSample) => Promise<void>;
  stop: () => void;
}

function startHarness(): Harness {
  const emits: TerminalEvent[] = [];
  let observable = true;
  const signals: SensorSignals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
  };
  const stop = startAgentSensor(
    fakeAdapter,
    { mirror: null, currentAgent: null },
    SHELL_PID,
    "/w",
    "term-1" as TerminalId,
    signals,
    undefined,
    () => observable,
    (o) => emits.push(o),
    log,
  );
  return {
    emits,
    setObservable: (v) => {
      observable = v;
    },
    foreground: async (sample) => {
      signals.foreground.publish(sample);
      await flush();
    },
    stop,
  };
}

// The `agent` events the assertions care about, in order.
const agentEvents = (emits: TerminalEvent[]) =>
  emits.filter((e) => e.kind === "agent");

const shellSample: ForegroundSample = { process: "", foregroundPid: SHELL_PID };
const agentSample: ForegroundSample = {
  process: "claude",
  foregroundPid: AGENT_PID,
};

describe("W12 — the agent sensor's resolved-null observability discriminant", () => {
  it("taps LIVE: a matched agent that quits emits an authoritative null (clears the target)", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      await h.foreground(shellSample);

      const agents = agentEvents(h.emits);
      // matched → the live agent value, then the genuine end → authoritative null.
      expect(agents.at(-1)).toEqual({ kind: "agent", agent: { value: null } });
    } finally {
      h.stop();
    }
  });

  it("taps FAILED: a resolved-null emits `unknown` (keep-last), NOT an authoritative null", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample);
      h.setObservable(false);
      await h.foreground(shellSample);

      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });
    } finally {
      h.stop();
    }
  });

  it("taps RECOVER: an unobservable→observable absence re-emits the authoritative null (F1)", async () => {
    const h = startHarness();
    try {
      // Match, then lose the taps and resolve null → `unknown` (agent kept).
      await h.foreground(agentSample);
      h.setObservable(false);
      await h.foreground(shellSample);
      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });

      // Taps recover; the agent ended while we were blind. The fresh sample marks
      // the terminal observable again — the resolved-null must NOW clear the (already
      // null `current`) session, or the dead agent stays resurrectable.
      h.setObservable(true);
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
