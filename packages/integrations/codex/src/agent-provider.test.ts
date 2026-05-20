import type { AgentTerminalState } from "anyagent";
import { localExecutor } from "kolu-io";
import type { Logger } from "kolu-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findSessionMock = vi.fn();

vi.mock("./core.ts", () => ({
  findSessionByDirectory: (
    dir: string,
    executor: typeof localExecutor,
    log?: Logger,
  ) => findSessionMock(dir, executor, log),
  resolveCodexPaths: vi.fn(),
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

  it("matches when the kernel basename is 'codex' (native install)", async () => {
    findSessionMock.mockReturnValue({ id: "t1", rolloutPath: "/tmp/r.jsonl" });
    const state = makeState({ readForegroundBasename: () => "codex" });
    await expect(
      codexProvider.resolveSession(state, localExecutor, noopLog),
    ).resolves.toEqual({
      id: "t1",
      rolloutPath: "/tmp/r.jsonl",
    });
    expect(findSessionMock).toHaveBeenCalledWith(
      "/repo",
      localExecutor,
      noopLog,
    );
  });

  it("matches when only lastAgentCommandName is 'codex' (npm shim #673)", async () => {
    findSessionMock.mockReturnValue({ id: "t2", rolloutPath: "/tmp/r.jsonl" });
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: "codex",
    });
    await expect(
      codexProvider.resolveSession(state, localExecutor, noopLog),
    ).resolves.toEqual({
      id: "t2",
      rolloutPath: "/tmp/r.jsonl",
    });
    expect(findSessionMock).toHaveBeenCalledWith(
      "/repo",
      localExecutor,
      noopLog,
    );
  });

  it("skips lookup when neither signal names codex", async () => {
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: null,
    });
    await expect(
      codexProvider.resolveSession(state, localExecutor, noopLog),
    ).resolves.toBeNull();
    expect(findSessionMock).not.toHaveBeenCalled();
  });

  it("skips lookup when lastAgentCommandName names a different agent", async () => {
    const state = makeState({
      readForegroundBasename: () => "bash",
      lastAgentCommandName: "opencode",
    });
    await expect(
      codexProvider.resolveSession(state, localExecutor, noopLog),
    ).resolves.toBeNull();
    expect(findSessionMock).not.toHaveBeenCalled();
  });
});
