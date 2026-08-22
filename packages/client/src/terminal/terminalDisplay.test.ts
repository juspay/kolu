import { type ActiveTerminal, LOCAL_LOCATION } from "@kolu/padi/surface";
import { terminalCaption } from "@kolu/terminal-vocab/terminalKey";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import {
  assignColors,
  buildTerminalDisplayInfos,
  terminalExportTitle,
} from "./terminalDisplay";

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/home/user/project",
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
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

  it("hue is a pure function of the key — co-set order and size do not shift it", () => {
    const r1 = assignColors(["b", "a"]);
    const r2 = assignColors(["a", "b"]);
    const r3 = assignColors(["a", "b", "zeta"]);
    expect(r1.get("a")).toBe(r2.get("a"));
    expect(r1.get("b")).toBe(r2.get("b"));
    // Adding keys that would sort earlier under a set-relative allocator
    // must not recolour an existing identity.
    expect(r3.get("a")).toBe(r1.get("a"));
    expect(r3.get("b")).toBe(r1.get("b"));
  });

  it("produces different colors for different keys", () => {
    const result = assignColors(["x", "y"]);
    expect(result.get("x")).not.toBe(result.get("y"));
  });

  it("does not collide ordinary distinct names that shared a % 360 bucket", () => {
    // Regression: integer `% 360` made `repo-15` and `repo-28` identical.
    const result = assignColors(["repo-15", "repo-28"]);
    expect(result.get("repo-15")).not.toBe(result.get("repo-28"));
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
    expect(info?.annotationColor).toMatch(/^oklch\(/);
    expect(info?.subCount).toBe(0);
  });

  it("does NOT carry the live terminal record (stale-snapshot class is unspellable)", () => {
    // The display info rides the `displayInfos` memo, which only rebuilds on
    // git / cwd / membership — NOT on pr / agent / foreground. Carrying `meta`
    // here once let a consumer read those fast fields off a snapshot the memo
    // never refreshed (the header lagged the dock on PR). This asserts the
    // photocopy is gone for good: live facts must come from `getMetadata(id)`.
    const info = buildTerminalDisplayInfos(
      ["id-1"],
      () => makeMeta({ git: makeGit() }),
      () => [],
    ).get("id-1");
    expect(info).toBeDefined();
    expect(info).not.toHaveProperty("meta");
  });

  it("uses cwd basename for group, shortened cwd for label, on non-git terminals", () => {
    const result = buildTerminalDisplayInfos(
      ["id-1"],
      () => makeMeta({ cwd: "/home/alice/projects/foo" }),
      () => [],
    );
    expect(result.get("id-1")?.key.group).toBe("foo");
    expect(result.get("id-1")?.key.label).toBe("~/projects/foo");
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

/** The title the two client-side exports (clipboard PNG, printed PDF) share.
 *
 *  The composition itself is `terminalCaption`'s and is pinned in
 *  `@kolu/terminal-vocab`; what is pinned HERE is the agreement — that this
 *  helper hands back exactly what padi's daemon-side screenshot captions the
 *  same terminal with, so the browser PNG and the agent PNG cannot part — plus
 *  the one arm the vocabulary deliberately refuses to own: metadata that has
 *  not arrived. */
describe("terminalExportTitle", () => {
  it("is the SAME caption the daemon's screenshot uses", () => {
    const meta = makeMeta({
      git: makeGit({ repoName: "kolu", branch: "wip" }),
    });
    expect(terminalExportTitle(meta)).toBe(terminalCaption(meta));
    expect(terminalExportTitle(meta)).toBe("kolu (wip)");

    const outsideRepo = makeMeta({ cwd: "/home/user/scratch" });
    expect(terminalExportTitle(outsideRepo)).toBe(terminalCaption(outsideRepo));
    expect(terminalExportTitle(outsideRepo)).toBe("scratch");
  });

  it("names the absent record once, for both exports", () => {
    // The PDF said "Terminal" and the screenshot said "terminal"; one terminal,
    // two names. Lowercase kept — it shares a title bar with the lowercase
    // `kolu` wordmark and stands in for repo/directory names, never title-cased.
    expect(terminalExportTitle(undefined)).toBe("terminal");
  });
});
