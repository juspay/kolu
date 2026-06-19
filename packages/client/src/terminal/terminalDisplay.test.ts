import type { TerminalId } from "kolu-common/surface";
import { LOCAL_LOCATION, type TerminalMetadata } from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { createMemo, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { assignColors, buildTerminalDisplayInfos } from "./terminalDisplay";

const tids = (...xs: string[]) => xs as TerminalId[];

function makeMeta(overrides: Partial<TerminalMetadata> = {}): TerminalMetadata {
  return {
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

describe("terminalIds reference stability (the #1422 reactivity keystone)", () => {
  // Reproduces the exact reactive shape of the `terminalIds` memo: it reads a
  // "metadata version" (so any single terminal's metadata change re-runs it) and
  // rebuilds a *fresh* array each run. Gated by `sameTerminalIdOrder` as its
  // `equals`, an unchanged id set must keep the prior reference so the downstream
  // display derivation does NOT re-run. This is the regression the fix prevents.
  // Local copy of the `equals` gate's behavior — the harness exercises the
  // reactive shape, not the comparator (which has its own unit tests).
  const sameOrder = (a: readonly TerminalId[], b: readonly TerminalId[]) =>
    a.length === b.length && a.every((id, i) => id === b[i]);
  function harness() {
    const [version, setVersion] = createSignal(0);
    const [ids, setIds] = createSignal(tids("a", "b", "c"));
    let innerRuns = 0;
    let downstreamRuns = 0;
    let displayInfos: () => number;
    const dispose = createRoot((d) => {
      const terminalIds = createMemo<TerminalId[]>(
        () => {
          innerRuns++;
          version(); // track: a metadata change on any terminal re-runs this
          return ids().slice(); // a new array reference every run
        },
        [],
        { equals: sameOrder },
      );
      // The expensive derivation `displayInfos` stands in for here.
      displayInfos = createMemo(() => {
        downstreamRuns++;
        return terminalIds().length;
      });
      displayInfos(); // initial computation
      return d;
    });
    return {
      runs: () => ({ inner: innerRuns, downstream: downstreamRuns }),
      // Solid memos are lazy — pull the downstream derivation to force the
      // (re)computation a render/effect would trigger in the real app.
      pull: () => displayInfos(),
      bumpMetadata: () => setVersion((v) => v + 1),
      setIds,
      dispose,
    };
  }

  it("re-runs the memo but NOT the downstream derivation when the id set is unchanged", () => {
    const h = harness();
    expect(h.runs()).toEqual({ inner: 1, downstream: 1 });

    h.bumpMetadata(); // a metadata field changed; top-level id set is identical
    h.pull();
    expect(h.runs()).toEqual({ inner: 2, downstream: 1 }); // gated: no re-derive

    h.bumpMetadata();
    h.pull();
    expect(h.runs()).toEqual({ inner: 3, downstream: 1 });
    h.dispose();
  });

  it("re-runs the downstream derivation when the id set actually changes", () => {
    const h = harness();
    expect(h.runs()).toEqual({ inner: 1, downstream: 1 });

    h.setIds(tids("a", "b")); // a terminal closed → the set changed
    h.pull();
    expect(h.runs()).toEqual({ inner: 2, downstream: 2 }); // propagates
    h.dispose();
  });

  it("re-runs the downstream derivation when the set is reordered", () => {
    const h = harness();
    h.setIds(tids("c", "b", "a"));
    h.pull();
    expect(h.runs().downstream).toBe(2); // order matters → invalidates
    h.dispose();
  });
});

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
