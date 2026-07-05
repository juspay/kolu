import { type ActiveTerminal, LOCAL_LOCATION } from "@kolu/padi/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import { assignColors, buildTerminalDisplayInfos } from "./terminalDisplay";

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/home/user/project",
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
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
    remoteUrl: null,
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
    expect(info?.presentation.group).toBe("repo");
    expect(info?.presentation.label).toBe("main");
    expect(info?.presentation.fallbackLabel).toBe("main");
    expect(info?.titleAnnotationLabel).toBe("main");
    expect(info?.repoColor).toMatch(/^oklch\(/);
    expect(info?.branchColor).toMatch(/^oklch\(/);
    expect(info?.subCount).toBe(0);
  });

  it("uses cwd basename for group, shortened cwd for label, on non-git terminals", () => {
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => makeMeta({ cwd: "/home/alice/projects/foo" }),
      () => [],
    );
    expect(result.get("id-1")?.key.group).toBe("foo");
    expect(result.get("id-1")?.key.label).toBe("~/projects/foo");
    expect(result.get("id-1")?.titleAnnotationLabel).toBe("—");
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

  it("stamps presentation suffixes on matching intent labels even when branches differ", () => {
    const result = buildTerminalDisplayInfos(
      ["aaaa-1", "bbbb-2"],
      (id) =>
        id === "aaaa-1"
          ? makeMeta({
              git: makeGit({ branch: "old-branch" }),
              intent: "Keep current task",
            })
          : makeMeta({
              git: makeGit({ branch: "new-branch" }),
              intent: "Keep current task",
            }),
      () => [],
    );

    expect(result.get("aaaa-1")?.key.suffix).toBeUndefined();
    expect(result.get("bbbb-2")?.key.suffix).toBeUndefined();
    expect(result.get("aaaa-1")?.presentation.label).toBe("Keep current task");
    expect(result.get("bbbb-2")?.presentation.label).toBe("Keep current task");
    expect(result.get("aaaa-1")?.presentation.suffix).toBe("#aaaa");
    expect(result.get("bbbb-2")?.presentation.suffix).toBe("#bbbb");
    expect(result.get("aaaa-1")?.annotationColor).toBe(
      result.get("bbbb-2")?.annotationColor,
    );
  });

  it("keeps annotation color stable when only the hidden branch identity changes", () => {
    const before = buildTerminalDisplayInfos(
      ["id-1"],
      () =>
        makeMeta({
          git: makeGit({ branch: "zzz-branch" }),
          intent: "Keep current task",
        }),
      () => [],
    );
    const after = buildTerminalDisplayInfos(
      ["id-1"],
      () =>
        makeMeta({
          git: makeGit({ branch: "aaa-branch" }),
          intent: "Keep current task",
        }),
      () => [],
    );

    expect(after.get("id-1")?.annotationColor).toBe(
      before.get("id-1")?.annotationColor,
    );
  });

  it("does NOT collide non-git terminals at different paths sharing a basename", () => {
    // Same basename, different paths → same `group` but different `label`
    // (the shortened cwd disambiguates). Suffix only fires when the full
    // (group, label) pair collides — same shape as git.
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
    expect(result.get("aaaa-1")?.key.group).toBe("foo");
    expect(result.get("bbbb-2")?.key.group).toBe("foo");
    expect(result.get("aaaa-1")?.key.label).toBe("~/projects/foo");
    expect(result.get("bbbb-2")?.key.label).toBe("~/work/foo");
    expect(result.get("aaaa-1")?.key.suffix).toBeUndefined();
    expect(result.get("bbbb-2")?.key.suffix).toBeUndefined();
  });

  it("collides non-git terminals at the same exact cwd", () => {
    const result = buildTerminalDisplayInfos(
      ["aaaa-1", "bbbb-2"],
      () => makeMeta({ cwd: "/home/alice/projects/foo" }),
      () => [],
    );
    expect(result.get("aaaa-1")?.key.suffix).toBe("#aaaa");
    expect(result.get("bbbb-2")?.key.suffix).toBe("#bbbb");
  });
});
