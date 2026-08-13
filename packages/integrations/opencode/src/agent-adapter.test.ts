import type { AgentTerminalState } from "anyagent";
import type { Logger } from "kolu-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findSessionsMock = vi.fn();

vi.mock("./core.ts", () => ({
  findSessionsByDirectory: (dir: string, log?: Logger) =>
    findSessionsMock(dir, log),
}));
vi.mock("./session-watcher.ts", () => ({ createOpenCodeWatcher: vi.fn() }));

const { opencodeAdapter } = await import("./agent-adapter.ts");

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

describe("opencodeAdapter.resolveSessions", () => {
  beforeEach(() => {
    findSessionsMock.mockReset();
  });

  it("matches when the kernel basename is 'opencode' (native install)", () => {
    findSessionsMock.mockReturnValue([{ id: "s1" }]);
    const state = makeState({ readForegroundBasename: () => "opencode" });
    expect(opencodeAdapter.resolveSessions(state, noopLog)).toEqual([
      { id: "s1" },
    ]);
    expect(findSessionsMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("matches when only lastAgentCommandName is 'opencode' (npm shim)", () => {
    findSessionsMock.mockReturnValue([{ id: "s2" }]);
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: "opencode",
    });
    expect(opencodeAdapter.resolveSessions(state, noopLog)).toEqual([
      { id: "s2" },
    ]);
    expect(findSessionsMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("skips lookup when neither signal names opencode", () => {
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: null,
    });
    expect(opencodeAdapter.resolveSessions(state, noopLog)).toEqual([]);
    expect(findSessionsMock).not.toHaveBeenCalled();
  });
});
