import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTerminalState, Logger } from "anyagent";

const findSessionMock = vi.fn();

vi.mock("./index.ts", () => ({
  findSessionByDirectory: (dir: string, log?: Logger) =>
    findSessionMock(dir, log),
}));
vi.mock("./session-watcher.ts", () => ({ createOpenCodeWatcher: vi.fn() }));

const { opencodeProvider } = await import("./agent-provider.ts");

const noopLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeState(over: Partial<AgentTerminalState>): AgentTerminalState {
  return {
    foregroundPid: 1000,
    cwd: "/repo",
    readForegroundBasename: () => null,
    lastAgentCommandName: null,
    ...over,
  };
}

describe("opencodeProvider.resolveSession", () => {
  beforeEach(() => {
    findSessionMock.mockReset();
  });

  it("matches when the kernel basename is 'opencode' (native install)", () => {
    findSessionMock.mockReturnValue({ id: "s1" });
    const state = makeState({ readForegroundBasename: () => "opencode" });
    expect(opencodeProvider.resolveSession(state, noopLog)).toEqual({
      id: "s1",
    });
    expect(findSessionMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("matches when only lastAgentCommandName is 'opencode' (npm shim)", () => {
    findSessionMock.mockReturnValue({ id: "s2" });
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: "opencode",
    });
    expect(opencodeProvider.resolveSession(state, noopLog)).toEqual({
      id: "s2",
    });
    expect(findSessionMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("skips lookup when neither signal names opencode", () => {
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: null,
    });
    expect(opencodeProvider.resolveSession(state, noopLog)).toBeNull();
    expect(findSessionMock).not.toHaveBeenCalled();
  });
});
