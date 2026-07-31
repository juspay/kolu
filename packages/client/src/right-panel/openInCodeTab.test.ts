import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focusTerminalSilently: vi.fn(),
  getMetadata: vi.fn(),
  rootAncestor: vi.fn(),
  openCodeAt: vi.fn(),
  reveal: vi.fn(),
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    focusTerminalSilently: h.focusTerminalSilently,
    getMetadata: h.getMetadata,
    rootAncestor: h.rootAncestor,
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
    h.getMetadata.mockReturnValue({
      id: "terminal-b",
      parentId: null,
      git: { repoRoot: "/repo" },
    });
    h.rootAncestor.mockImplementation((id: string) => id);
  });

  it("focuses the issuing terminal before opening its Code-tab request", () => {
    openInCodeTab({
      terminalId: "terminal-b",
      ref: { path: "new.ts", startLine: 1, endLine: 1 },
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

  it("focuses a split pane while scoping the request to its panel owner", () => {
    h.getMetadata.mockImplementation((id: string) =>
      id === "split-b"
        ? {
            id,
            parentId: "terminal-a",
            git: { repoRoot: "/split-repo" },
          }
        : {
            id,
            parentId: null,
            git: { repoRoot: "/owner-repo" },
          },
    );
    h.rootAncestor.mockImplementation((id: string) =>
      id === "split-b" ? "terminal-a" : id,
    );

    openInCodeTab({
      terminalId: "split-b",
      ref: { path: "new.ts", startLine: 1, endLine: 1 },
      targetMode: "browse",
    });

    expect(h.focusTerminalSilently).toHaveBeenCalledWith("split-b");
    expect(pendingOpen()?.scope).toMatchObject({
      terminalId: "terminal-a",
      repoRoot: "/owner-repo",
    });
  });
});
