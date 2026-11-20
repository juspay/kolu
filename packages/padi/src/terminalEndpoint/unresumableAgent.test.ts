import {
  type AgentInfo,
  seedMemory,
  seedSnapshot,
  type TerminalEvent,
  type TerminalId,
  type TerminalState,
} from "@kolu/terminal-vocab/schema";
import { describe, expect, it, vi } from "vitest";
import { type FoldCtx, fold } from "../terminalWorkspace/fold.ts";
import { unresumableAgentWatch } from "./local.ts";

const OPENCODE_ID = "ses_118316090ffewMmbj6bsfKwj4R";

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
    restoreTarget: { kind: "none" },
  };
  const emit = (o: TerminalEvent) => {
    const before = state;
    state = fold(state, o, ctx);
    if (state !== before) watch.check(state);
  };
  const noteRaw = (raw: string) => watch.noteRawCommand(raw);
  const agent = (value: AgentInfo | null, argv: readonly string[] = []) =>
    emit({
      kind: "agent",
      agent: { value: value === null ? null : { info: value, argv } },
    });
  return { warn, noteRaw, agent, state: () => state };
}

describe("the endpoint's unresumable-agent watch", () => {
  it("stays quiet for a resumable agent", () => {
    const h = harness();
    h.noteRaw(`opencode --session ${OPENCODE_ID}`);
    h.agent(opencode(OPENCODE_ID), ["--model", "sonnet"]);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("warns exactly once when the agent's ref fails its shape gate", () => {
    const h = harness();
    h.noteRaw("cat /tmp/forged");
    h.agent(opencode("not-a-session-id"));
    h.agent({ ...opencode("not-a-session-id"), state: "waiting" } as AgentInfo);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0]?.[0]).toEqual({
      terminal: "t1",
      agent: "opencode",
      reason: "no-resume-form",
      resumeRef: "not-a-session-id",
      lastRawCommand: "cat /tmp/forged",
    });
    expect(h.warn.mock.calls[0]?.[1]).toMatch(/cannot render a resume form/);
  });

  it("re-arms after the episode ends — a later unresumable agent warns again", () => {
    const h = harness();
    h.agent(opencode("bad"));
    expect(h.warn).toHaveBeenCalledTimes(1);
    h.agent(null);
    h.agent(opencode("still-bad"));
    expect(h.warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn for a shell with no agent at all", () => {
    const h = harness();
    h.noteRaw("ls -la");
    expect(h.warn).not.toHaveBeenCalled();
  });
});
