import type { AgentTerminalState, Logger } from "anyagent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findSessionMock = vi.fn();

vi.mock("./index.ts", () => ({
  findSessionByDirectory: (dir: string, log?: Logger) =>
    findSessionMock(dir, log),
}));
vi.mock("./session-watcher.ts", () => ({ createCodexWatcher: vi.fn() }));
vi.mock("./wal-watcher.ts", () => ({ subscribeCodexDb: vi.fn() }));

const { codexProvider } = await import("./agent-provider.ts");

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

describe("codexProvider.resolveSession", () => {
  beforeEach(() => {
    findSessionMock.mockReset();
  });

  it("matches when the kernel basename is 'codex' (native install)", () => {
    findSessionMock.mockReturnValue({ id: "t1", rolloutPath: "/tmp/r.jsonl" });
    const state = makeState({ readForegroundBasename: () => "codex" });
    expect(codexProvider.resolveSession(state, noopLog)).toEqual({
      id: "t1",
      rolloutPath: "/tmp/r.jsonl",
    });
    expect(findSessionMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("matches when only lastAgentCommandName is 'codex' (npm shim #673)", () => {
    findSessionMock.mockReturnValue({ id: "t2", rolloutPath: "/tmp/r.jsonl" });
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: "codex",
    });
    expect(codexProvider.resolveSession(state, noopLog)).toEqual({
      id: "t2",
      rolloutPath: "/tmp/r.jsonl",
    });
    expect(findSessionMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("skips lookup when neither signal names codex", () => {
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: null,
    });
    expect(codexProvider.resolveSession(state, noopLog)).toBeNull();
    expect(findSessionMock).not.toHaveBeenCalled();
  });

  it("skips lookup when lastAgentCommandName names a different agent", () => {
    const state = makeState({
      readForegroundBasename: () => "bash",
      lastAgentCommandName: "opencode",
    });
    expect(codexProvider.resolveSession(state, noopLog)).toBeNull();
    expect(findSessionMock).not.toHaveBeenCalled();
  });
});
