/** The half-state warning: a live agent identity with no remembered launch
 *  command warns once per agent episode, driven through the real `fold`. */

import {
  type AgentInfo,
  seedMemory,
  seedSnapshot,
  type TerminalEvent,
  type TerminalId,
  type TerminalState,
} from "@kolu/terminal-vocab/schema";
import { describe, expect, it, vi } from "vitest";
import { parseAgentCommand } from "kolu-agents";
import { type FoldCtx, fold } from "../terminalWorkspace/fold.ts";
import { unresumableAgentWatch } from "./unresumableAgent.ts";

const opencode = (sessionId: string): AgentInfo =>
  ({
    kind: "opencode",
    state: "thinking",
    sessionId,
    model: null,
    summary: null,
    taskProgress: null,
    contextTokens: null,
    startedAt: null,
  }) as AgentInfo;

const ctx: FoldCtx = { live: true, at: 1, runStartedAt: 0 };

function harness() {
  const warn = vi.fn();
  const watch = unresumableAgentWatch("t1" as TerminalId, { warn } as never);
  let state: TerminalState = {
    snapshot: seedSnapshot("/work"),
    memory: seedMemory(),
  };
  // The endpoint's emit loop in miniature: fold, then check on a delta.
  const emit = (o: TerminalEvent) => {
    const before = state;
    state = fold(state, o, ctx);
    if (state !== before) watch.check(state);
  };
  // The command sensor: emits a mark only for a line it recognizes.
  const typed = (raw: string) => {
    watch.noteRawCommand(raw);
    const command = parseAgentCommand(raw);
    if (command !== null)
      emit({ kind: "commandRun", command, replayed: false });
  };
  const agent = (value: AgentInfo | null) =>
    emit({ kind: "agent", agent: { value } });
  return { warn, typed, agent, state: () => state };
}

describe("unresumableAgentWatch", () => {
  it("warns exactly once for an agent whose launch line was not recognized", () => {
    const h = harness();
    h.typed("cd /work && opencode");
    h.agent(opencode("ses_a"));
    h.agent({ ...opencode("ses_a"), state: "waiting" } as AgentInfo);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]?.[0]).toEqual({
      terminal: "t1",
      agent: "opencode",
      reason: "unrecognized",
      lastRawCommand: "cd /work && opencode",
    });
    expect(h.warn.mock.calls[0]?.[1]).toMatch(/not recognized/);

    // A later recognized launch fills the memory — no further warning.
    h.agent(null);
    h.typed("FOO=bar opencode");
    h.agent(opencode("ses_b"));
    expect(h.state().memory.lastAgentCommand).toBe("FOO=bar opencode");
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  // No 633;E line at all (fish, a bare kaval-tui shell, history off): the
  // warning must not claim a line was seen and rejected.
  it("says no launch line was seen when the shell never reported one", () => {
    const h = harness();
    h.agent(opencode("ses_a"));
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]?.[0]).toEqual({
      terminal: "t1",
      agent: "opencode",
      reason: "no-launch-line",
    });
    expect(h.warn.mock.calls[0]?.[1]).toMatch(/no launch line was ever seen/);
  });

  it("stays quiet for a recognized prefixed launch", () => {
    const h = harness();
    h.typed("AI_PROFILE=github:juspay/skills opencode --auto");
    h.agent(opencode("ses_a"));
    expect(h.warn).not.toHaveBeenCalled();
  });
});
