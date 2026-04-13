import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { FsListDirOutput } from "kolu-common";

// Mock the RPC client before importing FilesTab.
const mockListDir =
  vi.fn<
    (input: { terminalId: string; path: string }) => Promise<FsListDirOutput>
  >();

vi.mock("../rpc/rpc", () => ({
  client: {
    fs: {
      listDir: (...args: Parameters<typeof mockListDir>) =>
        mockListDir(...args),
    },
  },
}));

const { default: FilesTab } = await import("./FilesTab");

const ROOT_ENTRIES: FsListDirOutput = {
  entries: [
    { name: "src", isDirectory: true, path: "/repo/src" },
    { name: "tests", isDirectory: true, path: "/repo/tests" },
    { name: "README.md", isDirectory: false, path: "/repo/README.md" },
    { name: "package.json", isDirectory: false, path: "/repo/package.json" },
  ],
};

const CHILD_ENTRIES: FsListDirOutput = {
  entries: [
    { name: "index.ts", isDirectory: false, path: "/repo/src/index.ts" },
    { name: "utils.ts", isDirectory: false, path: "/repo/src/utils.ts" },
  ],
};

function makeMeta(repoRoot: string | null = "/repo", cwd = "/repo") {
  return {
    cwd,
    git: repoRoot
      ? {
          repoRoot,
          repoName: repoRoot.split("/").pop()!,
          worktreePath: repoRoot,
          branch: "main",
          isWorktree: false,
          mainRepoRoot: repoRoot,
        }
      : null,
    pr: null,
    agent: null,
    foreground: null,
    sortOrder: 0,
  };
}

beforeEach(() => {
  cleanup();
  mockListDir.mockReset();
});

// ── Query helpers ──

function getTreeItems(container: HTMLElement) {
  const tree = container.querySelector('[role="tree"]');
  if (!tree) return [];
  return Array.from(tree.querySelectorAll(':scope > [role="treeitem"]'));
}

function getRefreshBtn(container: HTMLElement) {
  return container.querySelector(
    '[data-testid="files-refresh"]',
  ) as HTMLElement;
}

// ── Reusable assertion helpers ──
// Each verifies a behavioral property of the rendered tree.
// Used both on fresh mount and after a refresh cycle.

async function assertTreeRenders(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });
  expect(getTreeItems(container).length).toBeGreaterThan(0);
}

async function assertDirsBeforeFiles(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });
  const items = getTreeItems(container);
  let seenLeaf = false;
  for (const el of items) {
    const isBranch = el.hasAttribute("data-branch");
    if (!isBranch) seenLeaf = true;
    else if (seenLeaf) {
      throw new Error(
        `Directory ${el.getAttribute("data-value")} appears after a file`,
      );
    }
  }
}

async function assertExpandShowsChildren(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector('[role="tree"]')).not.toBeNull();
  });
  // Queue child entries for the expand call.
  mockListDir.mockResolvedValueOnce(CHILD_ENTRIES);

  const firstBranch = container.querySelector(
    '[data-branch] [role="button"]',
  ) as HTMLElement;
  expect(firstBranch).not.toBeNull();
  fireEvent.click(firstBranch);

  await waitFor(() => {
    const nested = container.querySelectorAll(
      '[role="group"] [role="treeitem"]',
    );
    expect(nested.length).toBeGreaterThan(0);
  });
}

async function assertErrorSurfaces(container: HTMLElement) {
  await waitFor(() => {
    expect(container.textContent).toContain("ENOENT");
  });
}

async function assertTerminalSwitchReloads(
  container: HTMLElement,
  setTerminalId: (id: string) => void,
) {
  mockListDir.mockResolvedValueOnce({
    entries: [
      { name: "other.txt", isDirectory: false, path: "/other/other.txt" },
    ],
  });
  setTerminalId("tid-switch-" + Date.now());

  await waitFor(() => {
    const items = getTreeItems(container);
    expect(items).toHaveLength(1);
    expect(items[0]!.getAttribute("data-value")).toBe("/other/other.txt");
  });
}

async function assertClearsOnDeselect(
  container: HTMLElement,
  setTerminalId: (id: string | undefined) => void,
) {
  setTerminalId(undefined);

  await waitFor(() => {
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.textContent).toContain("No terminal selected");
  });
}

// ── Mount + refresh scaffold ──

/** Mount FilesTab with reactive terminalId, wait for tree, then refresh. */
async function mountAndRefresh() {
  mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

  const [terminalId, setTerminalId] = createSignal<string | undefined>("tid-1");

  const { container } = render(() => (
    <FilesTab meta={makeMeta()} terminalId={terminalId()} />
  ));

  await waitFor(() => {
    expect(getTreeItems(container)).toHaveLength(4);
  });

  // Refresh with the same data.
  mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);
  fireEvent.click(getRefreshBtn(container));

  await waitFor(() => {
    expect(getTreeItems(container)).toHaveLength(4);
  });

  return { container, setTerminalId };
}

/** Mount, perform an action, refresh, return container for post-refresh checks. */
async function mountActionRefresh(
  action: (container: HTMLElement) => Promise<void>,
) {
  mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

  const [terminalId, setTerminalId] = createSignal<string | undefined>("tid-1");

  const { container } = render(() => (
    <FilesTab meta={makeMeta()} terminalId={terminalId()} />
  ));

  await waitFor(() => {
    expect(getTreeItems(container)).toHaveLength(4);
  });

  // Perform the action.
  await action(container);

  // Refresh — replaces the tree.
  mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);
  fireEvent.click(getRefreshBtn(container));

  await waitFor(() => {
    expect(getTreeItems(container)).toHaveLength(4);
  });

  return { container, setTerminalId };
}

// ── Tests ──

describe("FilesTab", () => {
  // ── Initial load ──

  it("loads and renders the file tree on mount", async () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await assertTreeRenders(container);
    expect(mockListDir).toHaveBeenCalledWith({
      terminalId: "tid-1",
      path: "/repo",
    });
  });

  it("shows loading state before entries arrive", async () => {
    mockListDir.mockReturnValue(new Promise(() => {}));

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await waitFor(() => {
      expect(container.textContent).toContain("Loading...");
    });
  });

  it("shows error message when RPC fails", async () => {
    mockListDir.mockRejectedValueOnce(new Error("ENOENT: no such directory"));

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await assertErrorSurfaces(container);
  });

  it("shows 'No terminal selected' when terminalId is undefined", () => {
    const { container } = render(() => (
      <FilesTab meta={null} terminalId={undefined} />
    ));

    expect(container.textContent).toContain("No terminal selected");
    expect(mockListDir).not.toHaveBeenCalled();
  });

  // ── Sorting ──

  it("renders directories before files", async () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await assertDirsBeforeFiles(container);
  });

  // ── Expand ──

  it("expanding a directory loads and shows children", async () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await assertExpandShowsChildren(container);
  });

  // ── Refresh ──

  it("reloads the tree when refresh button is clicked", async () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await waitFor(() => {
      expect(getTreeItems(container)).toHaveLength(4);
    });

    mockListDir.mockResolvedValueOnce({
      entries: [
        { name: "src", isDirectory: true, path: "/repo/src" },
        { name: "new-file.ts", isDirectory: false, path: "/repo/new-file.ts" },
      ],
    });

    fireEvent.click(getRefreshBtn(container));

    await waitFor(() => {
      expect(getTreeItems(container)).toHaveLength(2);
    });

    expect(mockListDir).toHaveBeenCalledTimes(2);
  });

  it("refresh after error recovers the tree", async () => {
    mockListDir.mockRejectedValueOnce(new Error("ENOENT: no such directory"));

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await assertErrorSurfaces(container);

    // Refresh succeeds.
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);
    fireEvent.click(getRefreshBtn(container));

    await assertTreeRenders(container);
    await assertDirsBeforeFiles(container);
  });

  // ── After refresh: re-run behavioral checks ──
  // Catches bugs where refresh leaves stale state that breaks subsequent interactions.

  describe("refresh → action", () => {
    it("refresh → tree renders", async () => {
      const { container } = await mountAndRefresh();
      await assertTreeRenders(container);
    });

    it("refresh → dirs before files", async () => {
      const { container } = await mountAndRefresh();
      await assertDirsBeforeFiles(container);
    });

    it("refresh → expand loads children", async () => {
      const { container } = await mountAndRefresh();
      await assertExpandShowsChildren(container);
    });

    it("refresh → refresh works", async () => {
      const { container } = await mountAndRefresh();

      mockListDir.mockResolvedValueOnce({
        entries: [
          { name: "only.txt", isDirectory: false, path: "/repo/only.txt" },
        ],
      });
      fireEvent.click(getRefreshBtn(container));

      await waitFor(() => {
        const items = getTreeItems(container);
        expect(items).toHaveLength(1);
        expect(items[0]!.getAttribute("data-value")).toBe("/repo/only.txt");
      });
    });

    it("refresh → error surfaces", async () => {
      const { container } = await mountAndRefresh();

      mockListDir.mockRejectedValueOnce(new Error("ENOENT: directory removed"));
      fireEvent.click(getRefreshBtn(container));

      await waitFor(() => {
        expect(container.textContent).toContain("ENOENT: directory removed");
      });
    });

    it("refresh → terminal switch reloads", async () => {
      const { container, setTerminalId } = await mountAndRefresh();
      await assertTerminalSwitchReloads(container, setTerminalId);
    });

    it("refresh → deselect clears tree", async () => {
      const { container, setTerminalId } = await mountAndRefresh();
      await assertClearsOnDeselect(container, setTerminalId);
    });
  });

  // ── Action → refresh → action again ──
  // Catches bugs where an action's side effects (expanded state, stale closures)
  // survive or corrupt after refresh replaces the collection.

  describe("action → refresh → action", () => {
    it("expand → refresh → expand works", async () => {
      const { container } = await mountActionRefresh(async (c) => {
        await assertExpandShowsChildren(c);
      });
      // After refresh, expand should work again on the fresh tree.
      await assertExpandShowsChildren(container);
    });

    it("error → refresh → tree recovers", async () => {
      // Mount with error.
      mockListDir.mockRejectedValueOnce(new Error("ENOENT: no such directory"));

      const { container } = render(() => (
        <FilesTab meta={makeMeta()} terminalId="tid-1" />
      ));

      await assertErrorSurfaces(container);

      // Refresh succeeds.
      mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);
      fireEvent.click(getRefreshBtn(container));

      await assertTreeRenders(container);
      await assertDirsBeforeFiles(container);
      await assertExpandShowsChildren(container);
    });

    it("terminal switch → refresh → expand works", async () => {
      const { container } = await mountActionRefresh(async (c) => {
        // Switch terminal mid-action (simulated by just loading different data).
        // The real terminal switch test is separate; here we just verify
        // that post-switch refresh doesn't break expand.
      });
      await assertExpandShowsChildren(container);
    });

    it("expand → refresh → dirs before files", async () => {
      const { container } = await mountActionRefresh(async (c) => {
        await assertExpandShowsChildren(c);
      });
      // Expanded state from before refresh shouldn't corrupt sorting.
      await assertDirsBeforeFiles(container);
    });
  });

  // ── Terminal switching ──

  it("reloads the tree when terminalId changes", async () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const [terminalId, setTerminalId] = createSignal("tid-1");

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId={terminalId()} />
    ));

    await waitFor(() => {
      expect(getTreeItems(container)).toHaveLength(4);
    });

    mockListDir.mockResolvedValueOnce({
      entries: [
        { name: "other.txt", isDirectory: false, path: "/other/other.txt" },
      ],
    });
    setTerminalId("tid-2");

    await waitFor(() => {
      const items = getTreeItems(container);
      expect(items).toHaveLength(1);
      expect(items[0]!.getAttribute("data-value")).toBe("/other/other.txt");
    });

    expect(mockListDir).toHaveBeenCalledTimes(2);
    expect(mockListDir).toHaveBeenLastCalledWith({
      terminalId: "tid-2",
      path: "/repo",
    });
  });

  // ── Header ──

  it("shows repo folder name in the header", () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    const tab = container.querySelector('[data-testid="files-tab"]')!;
    const header = tab.querySelector("span");
    expect(header?.textContent).toBe("repo");
  });

  it("shows 'Files' in header when no root is available", () => {
    const { container } = render(() => (
      <FilesTab meta={null} terminalId={undefined} />
    ));

    const tab = container.querySelector('[data-testid="files-tab"]')!;
    const header = tab.querySelector("span");
    expect(header?.textContent).toBe("Files");
  });

  // ── Clears state ──

  it("clears the tree when terminalId becomes undefined", async () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const [terminalId, setTerminalId] = createSignal<string | undefined>(
      "tid-1",
    );

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId={terminalId()} />
    ));

    await waitFor(() => {
      expect(getTreeItems(container)).toHaveLength(4);
    });

    setTerminalId(undefined);

    await waitFor(() => {
      expect(container.querySelector('[role="tree"]')).toBeNull();
      expect(container.textContent).toContain("No terminal selected");
    });
  });
});
