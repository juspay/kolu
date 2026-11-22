import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  focusTerminalSilently: vi.fn(),
  getMetadata: vi.fn(),
  openCodeAt: vi.fn(),
  reveal: vi.fn(),
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    focusTerminalSilently: h.focusTerminalSilently,
    getMetadata: h.getMetadata,
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

import { paneCodeOwner } from "./codeSubject";
import { codeOwner } from "./codeTabOpenController";
import { createCodeDoor } from "./codeDoor";
import { openInCodeTab, pendingOpen } from "./openInCodeTab";

describe("openInCodeTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.getMetadata.mockReturnValue({
      id: "terminal-b",
      parentId: null,
      git: { kind: "repo", info: { repoRoot: "/repo" } },
    });
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
      owner: paneCodeOwner("terminal-b"),
      repoRoot: "/repo",
      mode: "browse",
    });
  });

  it("scopes a split's request to the SPLIT's own repo, not its tile's", () => {
    // The panel follows the focused pane, so a path clicked in a split resolves
    // against that split's repo — the prefix the old panel-owner indirection got
    // wrong.
    h.getMetadata.mockImplementation((id: string) =>
      id === "split-b"
        ? {
            id,
            parentId: "terminal-a",
            git: { kind: "repo", info: { repoRoot: "/split-repo" } },
          }
        : {
            id,
            parentId: null,
            git: { kind: "repo", info: { repoRoot: "/tile-repo" } },
          },
    );

    openInCodeTab({
      terminalId: "split-b",
      ref: { path: "new.ts", startLine: 1, endLine: 1 },
      targetMode: "browse",
    });

    expect(h.focusTerminalSilently).toHaveBeenCalledWith("split-b");
    expect(pendingOpen()?.scope).toMatchObject({
      owner: paneCodeOwner("split-b"),
      repoRoot: "/split-repo",
    });
  });

  it("fails loud when the issuing terminal has no repo", () => {
    h.getMetadata.mockReturnValue({
      id: "terminal-b",
      parentId: null,
      git: { kind: "none" },
    });
    expect(() =>
      openInCodeTab({
        terminalId: "terminal-b",
        ref: { path: "new.ts", startLine: 1, endLine: 1 },
        targetMode: "browse",
      }),
    ).toThrow(/terminal-b has no repo/);
  });

  // Two Code views can be mounted at once. A link followed in one view's
  // document must land in THAT view — never move the Right panel's focus, tab
  // or open file, and never be answered by the other view.
  it("a request made in one view's door is seen by that view alone", () => {
    const work = codeOwner("a-caller's-own-kind", "w-1");
    const own = createCodeDoor((mode) => ({
      host: { kind: "local" },
      owner: work,
      repoRoot: "/worktree",
      mode,
    }));
    const panelBefore = pendingOpen();

    own.open({
      ref: { path: "notes.md", startLine: 3, endLine: 3 },
      targetMode: "browse",
    });

    expect(own.pending()?.scope).toEqual({
      host: { kind: "local" },
      owner: work,
      repoRoot: "/worktree",
      mode: "browse",
    });
    expect(own.pending()?.ref.path).toBe("notes.md");
    expect(pendingOpen()).toBe(panelBefore);
    expect(h.focusTerminalSilently).not.toHaveBeenCalled();
    expect(h.openCodeAt).not.toHaveBeenCalled();
    expect(h.reveal).not.toHaveBeenCalled();

    const ownBefore = own.pending();
    openInCodeTab({
      terminalId: "terminal-b",
      ref: { path: "new.ts", startLine: 1, endLine: 1 },
      targetMode: "browse",
    });
    expect(pendingOpen()?.ref.path).toBe("new.ts");
    expect(own.pending()).toBe(ownBefore);
  });
});
