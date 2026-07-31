import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focusTerminalSilently: vi.fn(),
  openCodeAt: vi.fn(),
  reveal: vi.fn(),
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    focusTerminalSilently: h.focusTerminalSilently,
  }),
}));

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
}));

vi.mock("./useRightPanel", () => ({
  useRightPanel: () => ({
    openCodeAt: h.openCodeAt,
    reveal: h.reveal,
  }),
}));

import { openInCodeTab, pendingOpen } from "./openInCodeTab";

describe("openInCodeTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("focuses the issuing terminal before opening its Code-tab request", () => {
    openInCodeTab({
      terminalId: "terminal-b",
      ref: { path: "new.ts", startLine: 1, endLine: 1 },
      repoRoot: "/repo",
      targetMode: "browse",
    });

    expect(h.focusTerminalSilently).toHaveBeenCalledWith("terminal-b");
    expect(h.openCodeAt).toHaveBeenCalledWith("browse");
    expect(h.reveal).toHaveBeenCalledOnce();
    expect(h.focusTerminalSilently.mock.invocationCallOrder[0]).toBeLessThan(
      h.openCodeAt.mock.invocationCallOrder[0] ?? 0,
    );
    expect(pendingOpen()?.scope).toMatchObject({
      host: { kind: "local" },
      terminalId: "terminal-b",
      repoRoot: "/repo",
      mode: "browse",
    });
  });
});
