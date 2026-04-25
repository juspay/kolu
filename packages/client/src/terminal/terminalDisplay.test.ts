import type { GitInfo, TerminalMetadata } from "kolu-common";
import { describe, expect, it } from "vitest";
import {
  assignColors,
  buildTerminalDisplayInfos,
  terminalName,
} from "./terminalDisplay";

function makeMeta(overrides: Partial<TerminalMetadata> = {}): TerminalMetadata {
  return {
    cwd: "/home/user/project",
    git: null,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ...overrides,
  };
}

function makeGit(overrides: Partial<GitInfo> = {}): GitInfo {
  return {
    repoRoot: "/home/user/repo",
    repoName: "repo",
    worktreePath: "/home/user/repo",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/repo",
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
    for (const color of result.values()) {
      expect(color).toMatch(/^oklch\(/);
    }
  });

  it("deduplicates keys", () => {
    expect(assignColors(["a", "a", "b"]).size).toBe(2);
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
    expect(
      terminalName(makeMeta({ git: makeGit({ repoName: "my-repo" }) })),
    ).toBe("my-repo");
  });

  it("falls back to cwd basename when no git", () => {
    expect(terminalName(makeMeta())).toBe("project");
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
    );
    expect(result.size).toBe(0);
  });

  it("builds display info with colors", () => {
    const meta = makeMeta({ git: makeGit() });
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => meta,
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
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => makeMeta(),
      () => ["sub-1", "sub-2"],
    );
    expect(result.get("id-1")!.subCount).toBe(2);
  });

  it("skips terminals with no metadata", () => {
    const result = buildTerminalDisplayInfos(
      ["id-1", "id-2"],
      (id) => (id === "id-1" ? makeMeta() : undefined),
      () => [],
    );
    expect(result.size).toBe(1);
    expect(result.has("id-1")).toBe(true);
    expect(result.has("id-2")).toBe(false);
  });

  it("leaves unique terminals without a collision suffix", () => {
    const result = buildTerminalDisplayInfos(
      ["aaaa-1", "bbbb-2"],
      (id) =>
        id === "aaaa-1"
          ? makeMeta({ git: makeGit({ branch: "main" }) })
          : makeMeta({ git: makeGit({ branch: "feature" }) }),
      () => [],
    );
    expect(result.get("aaaa-1")!.key.suffix).toBeUndefined();
    expect(result.get("bbbb-2")!.key.suffix).toBeUndefined();
  });

  it("stamps collision suffixes on terminals sharing (group, label)", () => {
    const result = buildTerminalDisplayInfos(
      ["aaaa-1", "bbbb-2", "cccc-3"],
      (id) =>
        id === "cccc-3"
          ? makeMeta({ git: makeGit({ branch: "feature" }) })
          : makeMeta({ git: makeGit({ branch: "main" }) }),
      () => [],
    );
    expect(result.get("aaaa-1")!.key.suffix).toBe("#aaaa");
    expect(result.get("bbbb-2")!.key.suffix).toBe("#bbbb");
    expect(result.get("cccc-3")!.key.suffix).toBeUndefined();
  });
});
