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

// Import after mock is set up.
const { default: FilesTab } = await import("./FilesTab");

const ROOT_ENTRIES: FsListDirOutput = {
  entries: [
    { name: "src", isDirectory: true, path: "/repo/src" },
    { name: "tests", isDirectory: true, path: "/repo/tests" },
    { name: "README.md", isDirectory: false, path: "/repo/README.md" },
    { name: "package.json", isDirectory: false, path: "/repo/package.json" },
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

/** Query top-level tree items within a container. */
function getTreeItems(container: HTMLElement) {
  const tree = container.querySelector('[role="tree"]');
  if (!tree) return [];
  return Array.from(tree.querySelectorAll(':scope > [role="treeitem"]'));
}

describe("FilesTab", () => {
  // ── Initial load ──

  it("loads and renders the file tree on mount", async () => {
    mockListDir.mockResolvedValueOnce(ROOT_ENTRIES);

    const { container } = render(() => (
      <FilesTab meta={makeMeta()} terminalId="tid-1" />
    ));

    await waitFor(() => {
      expect(container.querySelector('[role="tree"]')).not.toBeNull();
    });

    expect(getTreeItems(container)).toHaveLength(4);
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

    await waitFor(() => {
      expect(container.textContent).toContain("ENOENT: no such directory");
    });
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

    await waitFor(() => {
      expect(container.querySelector('[role="tree"]')).not.toBeNull();
    });

    const items = getTreeItems(container);
    const values = items.map((el) => ({
      value: el.getAttribute("data-value"),
      isBranch: el.hasAttribute("data-branch"),
    }));

    expect(values).toEqual([
      { value: "/repo/src", isBranch: true },
      { value: "/repo/tests", isBranch: true },
      { value: "/repo/README.md", isBranch: false },
      { value: "/repo/package.json", isBranch: false },
    ]);
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

    const updatedEntries: FsListDirOutput = {
      entries: [
        { name: "src", isDirectory: true, path: "/repo/src" },
        { name: "new-file.ts", isDirectory: false, path: "/repo/new-file.ts" },
      ],
    };
    mockListDir.mockResolvedValueOnce(updatedEntries);

    const refreshBtn = container.querySelector(
      '[data-testid="files-refresh"]',
    ) as HTMLElement;
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(getTreeItems(container)).toHaveLength(2);
    });

    expect(mockListDir).toHaveBeenCalledTimes(2);
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

    const newEntries: FsListDirOutput = {
      entries: [
        { name: "other.txt", isDirectory: false, path: "/other/other.txt" },
      ],
    };
    mockListDir.mockResolvedValueOnce(newEntries);
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
