import type { AgentTerminalState } from "anyagent";
import type { Logger } from "kolu-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findSessionsMock = vi.fn();

vi.mock("./core.ts", () => ({
  findSessionsByDirectory: (dir: string, log?: Logger) =>
    findSessionsMock(dir, log),
}));
vi.mock("./session-watcher.ts", () => ({ createCodexWatcher: vi.fn() }));
vi.mock("./wal-watcher.ts", () => ({ subscribeCodexDb: vi.fn() }));

const { codexAdapter } = await import("./agent-adapter.ts");

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

describe("codexAdapter.resolveSessions", () => {
  beforeEach(() => {
    findSessionsMock.mockReset();
  });

  it("matches when the kernel basename is 'codex' (native install)", () => {
    findSessionsMock.mockReturnValue([
      { id: "t1", rolloutPath: "/tmp/r.jsonl" },
    ]);
    const state = makeState({ readForegroundBasename: () => "codex" });
    expect(codexAdapter.resolveSessions(state, noopLog)).toEqual([
      { id: "t1", rolloutPath: "/tmp/r.jsonl" },
    ]);
    expect(findSessionsMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("matches when only lastAgentCommandName is 'codex' (npm shim #673)", () => {
    findSessionsMock.mockReturnValue([
      { id: "t2", rolloutPath: "/tmp/r.jsonl" },
    ]);
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: "codex",
    });
    expect(codexAdapter.resolveSessions(state, noopLog)).toEqual([
      { id: "t2", rolloutPath: "/tmp/r.jsonl" },
    ]);
    expect(findSessionsMock).toHaveBeenCalledWith("/repo", noopLog);
  });

  it("hands back EVERY thread in the directory, not just the newest", () => {
    // Two harnesses in one repo: the adapter cannot tell which thread is this
    // terminal's, so it offers both and the orchestrator's ownership arbiter
    // gives each terminal one of its own (juspay/kolu#2057).
    findSessionsMock.mockReturnValue([
      { id: "newer", rolloutPath: "/tmp/b.jsonl" },
      { id: "older", rolloutPath: "/tmp/a.jsonl" },
    ]);
    const state = makeState({ readForegroundBasename: () => "codex" });
    expect(
      codexAdapter.resolveSessions(state, noopLog).map((s) => s.id),
    ).toEqual(["newer", "older"]);
  });

  it("skips lookup when neither signal names codex", () => {
    const state = makeState({
      readForegroundBasename: () => "node",
      lastAgentCommandName: null,
    });
    expect(codexAdapter.resolveSessions(state, noopLog)).toEqual([]);
    expect(findSessionsMock).not.toHaveBeenCalled();
  });

  it("skips lookup when lastAgentCommandName names a different agent", () => {
    const state = makeState({
      readForegroundBasename: () => "bash",
      lastAgentCommandName: "opencode",
    });
    expect(codexAdapter.resolveSessions(state, noopLog)).toEqual([]);
    expect(findSessionsMock).not.toHaveBeenCalled();
  });
});
