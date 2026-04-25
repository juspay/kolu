import type { GitInfo, TerminalMetadata } from "kolu-common";
import { describe, expect, it } from "vitest";
import { assignColors, buildTerminalDisplayInfos } from "./terminalDisplay";

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

describe("buildTerminalDisplayInfos", () => {
  it("returns empty map for empty ids", () => {
    const result = buildTerminalDisplayInfos(
      [],
      () => undefined,
      () => [],
    );
    expect(result.size).toBe(0);
  });

  it("builds display info with colors and identity key", () => {
    const meta = makeMeta({ git: makeGit() });
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => meta,
      () => [],
    );
    const info = result.get("id-1");
    expect(info?.key.group).toBe("repo");
    expect(info?.key.label).toBe("main");
    expect(info?.repoColor).toMatch(/^oklch\(/);
    expect(info?.branchColor).toMatch(/^oklch\(/);
    expect(info?.subCount).toBe(0);
  });

  it("uses cwd basename as both group and label for non-git terminals", () => {
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => makeMeta(),
      () => [],
    );
    expect(result.get("id-1")?.key.group).toBe("project");
    expect(result.get("id-1")?.key.label).toBe("project");
  });

  it("counts sub-terminals", () => {
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => makeMeta(),
      () => ["sub-1", "sub-2"],
    );
    expect(result.get("id-1")?.subCount).toBe(2);
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
    expect(result.get("aaaa-1")?.key.suffix).toBeUndefined();
    expect(result.get("bbbb-2")?.key.suffix).toBeUndefined();
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
    expect(result.get("aaaa-1")?.key.suffix).toBe("#aaaa");
    expect(result.get("bbbb-2")?.key.suffix).toBe("#bbbb");
    expect(result.get("cccc-3")?.key.suffix).toBeUndefined();
  });

  it("collides non-git terminals at different cwds with same basename", () => {
    // Pre-consolidation: non-git used full cwd as identity, so same-basename
    // never collided (and shipped full paths into the UI). New rule: basename
    // is the identity, so collisions get suffixed — same shape as git.
    const result = buildTerminalDisplayInfos(
      ["aaaa-1", "bbbb-2"],
      (id) =>
        makeMeta({
          cwd:
            id === "aaaa-1"
              ? "/home/alice/projects/foo"
              : "/home/alice/work/foo",
        }),
      () => [],
    );
    expect(result.get("aaaa-1")?.key.suffix).toBe("#aaaa");
    expect(result.get("bbbb-2")?.key.suffix).toBe("#bbbb");
  });
});
