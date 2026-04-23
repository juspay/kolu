import { describe, it, expect, vi, afterEach } from "vitest";
import { codexProvider } from "./agent-provider.ts";
import type { AgentTerminalState } from "anyagent";

const findSessionByDirectory = vi.fn();

vi.mock("./index.ts", () => ({
  findSessionByDirectory,
}));

afterEach(() => {
  findSessionByDirectory.mockReset();
});

function state({
  foreground,
  invoked,
}: {
  foreground: string | null;
  invoked: string | null;
}): AgentTerminalState {
  return {
    foregroundPid: 123,
    cwd: "/tmp/project",
    readForegroundBasename: () => foreground,
    readInvokedAgentBasename: () => invoked,
  };
}

const log = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("codexProvider.resolveSession", () => {
  it("matches direct codex foreground sessions", () => {
    const session = { id: "t1" };
    findSessionByDirectory.mockReturnValue(session);

    expect(
      codexProvider.resolveSession(
        state({ foreground: "codex", invoked: null }),
        log,
      ),
    ).toBe(session);
    expect(findSessionByDirectory).toHaveBeenCalledWith("/tmp/project", log);
  });

  it("matches node-wrapped codex sessions via the invoked command basename", () => {
    const session = { id: "t2" };
    findSessionByDirectory.mockReturnValue(session);

    expect(
      codexProvider.resolveSession(
        state({ foreground: "node", invoked: "codex" }),
        log,
      ),
    ).toBe(session);
    expect(findSessionByDirectory).toHaveBeenCalledWith("/tmp/project", log);
  });

  it("rejects unrelated commands", () => {
    expect(
      codexProvider.resolveSession(
        state({ foreground: "node", invoked: null }),
        log,
      ),
    ).toBeNull();
    expect(findSessionByDirectory).not.toHaveBeenCalled();
  });
});
