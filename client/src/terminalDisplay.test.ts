import { describe, it, expect } from "vitest";
import {
  assignColors,
  terminalName,
  buildTerminalDisplayInfos,
} from "./terminalDisplay";
import type { TerminalMetadata, ActivitySample } from "kolu-common";

function makeMeta(overrides: Partial<TerminalMetadata> = {}): TerminalMetadata {
  return {
    cwd: "/home/user/project",
    git: null,
    pr: null,
    claude: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("assignColors", () => {
  it("returns empty map for empty input", () => {
    expect(assignColors([])).toEqual(new Map());
  });

  it("assigns a color to each unique key", () => {
    const result = assignColors(["a", "b", "c"]);
    expect(result.size).toBe(3);
    expect(result.get("a")).toMatch(/^oklch\(/);
    expect(result.get("b")).toMatch(/^oklch\(/);
    expect(result.get("c")).toMatch(/^oklch\(/);
  });

  it("deduplicates keys", () => {
    const result = assignColors(["a", "a", "b"]);
    expect(result.size).toBe(2);
  });

  it("sorts keys before assigning (deterministic)", () => {
    const r1 = assignColors(["b", "a"]);
    const r2 = assignColors(["a", "b"]);
    expect(r1.get("a")).toBe(r2.get("a"));
    expect(r1.get("b")).toBe(r2.get("b"));
  });

  it("produces different colors for different keys", () => {
    const result = assignColors(["x", "y"]);
    expect(result.get("x")).not.toBe(result.get("y"));
  });
});

describe("terminalName", () => {
  it("returns repo name when git info is present", () => {
    const meta = makeMeta({
      git: {
        repoRoot: "/home/user/repo",
        repoName: "my-repo",
        worktreePath: "/home/user/repo",
        branch: "main",
        isWorktree: false,
        mainRepoRoot: "/home/user/repo",
      },
    });
    expect(terminalName(meta)).toBe("my-repo");
  });

  it("falls back to cwd basename when no git", () => {
    expect(terminalName(makeMeta({ cwd: "/home/user/project" }))).toBe(
      "project",
    );
  });

  it("falls back to cwd basename ~ for home dir", () => {
    expect(terminalName(makeMeta({ cwd: "/root" }))).toBe("~");
  });
});

describe("buildTerminalDisplayInfos", () => {
  it("returns empty map for empty ids", () => {
    const result = buildTerminalDisplayInfos(
      [],
      () => undefined,
      () => [],
      () => [],
    );
    expect(result.size).toBe(0);
  });

  it("builds display info with colors", () => {
    const meta = makeMeta({
      git: {
        repoRoot: "/r",
        repoName: "repo",
        worktreePath: "/r",
        branch: "main",
        isWorktree: false,
        mainRepoRoot: "/r",
      },
    });
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => meta,
      () => [] as ActivitySample[],
      () => [],
    );
    expect(result.size).toBe(1);
    const info = result.get("id-1")!;
    expect(info.name).toBe("repo");
    expect(info.repoColor).toMatch(/^oklch\(/);
    expect(info.branchColor).toMatch(/^oklch\(/);
    expect(info.subCount).toBe(0);
  });

  it("counts sub-terminals", () => {
    const meta = makeMeta();
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => meta,
      () => [] as ActivitySample[],
      () => ["sub-1", "sub-2"],
    );
    expect(result.get("id-1")!.subCount).toBe(2);
  });

  it("skips terminals with no metadata", () => {
    const result = buildTerminalDisplayInfos(
      ["id-1", "id-2"],
      (id) => (id === "id-1" ? makeMeta() : undefined),
      () => [] as ActivitySample[],
      () => [],
    );
    expect(result.size).toBe(1);
    expect(result.has("id-1")).toBe(true);
    expect(result.has("id-2")).toBe(false);
  });
});
