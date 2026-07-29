import { FileTree as PierreFileTree } from "@pierre/trees";
import { describe, expect, it } from "vitest";
import {
  ancestorDirectoryPaths,
  directoryRemovalOps,
  pathDiffOperations,
} from "./pathReconcile";

const remove = (path: string) => ({ type: "remove", path, recursive: true });

// Repro for the Code-tab freeze toast:
//   File tree render failed: Cannot remove a non-empty directory without
//   recursive: ".claude/"
//
// Causal chain (host switch leaves the tree frozen on the OLD host's files):
// 1. The browse merge can transiently hold BOTH a collapsed overlay dir
//    (".claude/") AND tracked files under it (".claude/a.md") — a state a
//    single consistent git listing never produces.
// 2. pathDiffOperations treats every inventory entry as a file, so when the
//    stale ".claude/" drops it emits `{type:"remove", path:".claude/"}`
//    WITHOUT recursive:true (only directoryRemovalOps sets that flag).
// 3. @pierre/trees throws on non-recursive remove of a non-empty directory.
// 4. FileTree.tsx's safeApply catches the throw but never advances
//    appliedPaths, so every later paths change re-diffs against the stale
//    bookkeeping, re-emits the doomed remove, and freezes the tree forever.
//
// These tests assert the DESIRED behaviour (transition applies; tree advances).
// They fail today for the bug's reason — that is intentional: this PR is
// repro-only; the fix lands separately.
describe("mixed inventory: collapsed dir + tracked child (Code-tab freeze repro)", () => {
  // Inventory shape the host-switch race can hand FileTree for one tick.
  const mixed = [".claude/a.md", ".claude/"];
  const settled = [".claude/a.md"];
  const later = [".claude/a.md", "src/app.ts"];

  const makeTree = (paths: string[]) =>
    new PierreFileTree({
      paths,
      search: false,
      flattenEmptyDirectories: true,
      initialExpansion: "open",
    });

  it("pathDiffOperations emits a non-recursive remove for the collapsed dir", () => {
    // Pin the doomed op shape — this is what FileTree.batch receives today.
    // A correct fix either never produces this op, or marks it recursive.
    expect(pathDiffOperations(mixed, settled)).toEqual([
      { type: "remove", path: ".claude/" },
    ]);
  });

  it("applies the mixed→settled transition on a real Pierre tree without throwing", () => {
    const tree = makeTree(mixed);
    expect(tree.getItem(".claude/a.md")).not.toBeNull();
    expect(tree.getItem(".claude/")).not.toBeNull();

    // Desired: dropping the stale collapsed-dir entry leaves the tracked child
    // and does not throw. Today Pierre throws exactly the production toast.
    expect(() => {
      tree.batch(pathDiffOperations(mixed, settled));
    }).not.toThrow();
    expect(tree.getItem(".claude/a.md")).not.toBeNull();
    tree.cleanUp();
  });

  it("does not freeze subsequent inventory changes after the collapsed-dir drop", () => {
    // Models FileTree.tsx's paths-reconcile effect: safeApply catches the
    // throw, so appliedPaths never advances past the mixed inventory. Every
    // later change re-diffs against that stale bookkeeping and re-throws.
    let appliedPaths = [...mixed];
    const tree = makeTree(appliedPaths);

    const tryApply = (paths: string[]): boolean => {
      try {
        const ops = pathDiffOperations(appliedPaths, paths);
        if (ops.length > 0) tree.batch(ops);
        appliedPaths = paths;
        return true;
      } catch {
        // safeApply catches and toasts — appliedPaths stays put.
        return false;
      }
    };

    // Desired: both steps succeed and the tree advances to the new inventory.
    expect(tryApply(settled)).toBe(true);
    expect(appliedPaths).toEqual(settled);
    expect(tryApply(later)).toBe(true);
    expect(appliedPaths).toEqual(later);
    expect(tree.getItem("src/app.ts")).not.toBeNull();
    tree.cleanUp();
  });
});

describe("directoryRemovalOps", () => {
  it("removes nothing when the file set is unchanged", () => {
    const files = ["a/b/c.ts", "a/d.ts"];
    expect(directoryRemovalOps(files, files)).toEqual([]);
  });

  it("removes nothing when the filter clears (next is the full superset)", () => {
    // An empty query projects the full inventory back as `next`; its ancestor
    // set then covers every directory, so nothing is pruned and the file batch
    // re-adds the rest.
    const matches = ["docs/plans/x.html"];
    const full = ["docs/plans/x.html", "src/a.ts", "src/b.ts"];
    expect(directoryRemovalOps(matches, full)).toEqual([]);
  });

  it("prunes sibling subtrees down to a single deep match", () => {
    const prev = [
      ".claude/skills/parcel/SKILL.md",
      "docs/plans/keep.html",
      "src/app.ts",
    ];
    const next = ["docs/plans/keep.html"];
    expect(directoryRemovalOps(prev, next)).toEqual([
      remove(".claude/"),
      remove("src/"),
    ]);
  });

  it("collapses a nested dead subtree into one recursive op on the shallowest root", () => {
    const prev = ["a/b/c/d.ts", "keep/x.ts"];
    const next = ["keep/x.ts"];
    // a/, a/b/, a/b/c/ are all orphaned — only the shallowest (a/) is emitted;
    // its recursive remove takes the rest.
    expect(directoryRemovalOps(prev, next)).toEqual([remove("a/")]);
  });

  it("keeps a directory that still holds a match alongside a dropped sibling file", () => {
    const prev = ["pkg/match.ts", "pkg/other.ts"];
    const next = ["pkg/match.ts"];
    // pkg/ still has a live file ⇒ not pruned; the dropped file orphans no dir.
    expect(directoryRemovalOps(prev, next)).toEqual([]);
  });

  it("prunes directories that lost their last match as a filter narrows", () => {
    const prev = ["docs/plans/a.html", "docs/proposals/b.html"];
    const next = ["docs/plans/a.html"];
    // docs/ survives (plans/ still matches); only docs/proposals/ is pruned.
    expect(directoryRemovalOps(prev, next)).toEqual([
      remove("docs/proposals/"),
    ]);
  });
});

// Integration: drive a real Pierre `FileTree` headlessly (no `render()`, so no
// DOM needed) and assert via `getItem`, which resolves against the store. This
// is the layer the pure unit tests above cannot reach — it proves the ops,
// fed through Pierre's `batch`, actually prune the rows that Pierre's own
// `remove` would otherwise strand.
describe("directoryRemovalOps applied to a Pierre tree", () => {
  const full = [
    ".claude/skills/parcel/SKILL.md",
    ".codex/agents/x.md",
    "docs/plans/keep.html",
    "docs/proposals/p.html",
  ];
  const matches = ["docs/plans/keep.html"];

  const makeTree = (paths: string[]) =>
    new PierreFileTree({
      paths,
      search: false,
      flattenEmptyDirectories: true,
      initialExpansion: "open",
    });

  const fileRemovals = (prev: string[], next: string[]) => {
    const keep = new Set(next);
    return prev
      .filter((p) => !keep.has(p))
      .map((path) => ({ type: "remove" as const, path }));
  };

  // `getItem` returns a file-or-directory handle union; narrow to the directory
  // handle (which exposes `isExpanded`/`collapse`) so the expansion assertions
  // type-check.
  const dirHandle = (tree: PierreFileTree, path: string) => {
    const item = tree.getItem(path);
    return item != null && "isExpanded" in item ? item : null;
  };

  it("Pierre strands emptied directories on a plain file batch (regression baseline)", () => {
    const tree = makeTree(full);
    tree.batch(fileRemovals(full, matches));
    // The bug this PR fixes: the emptied directories survive as explicit empty
    // folders even though every file under them is gone.
    expect(tree.getItem(".claude/skills/")).not.toBeNull();
    expect(tree.getItem(".codex/")).not.toBeNull();
    tree.cleanUp();
  });

  it("prunes the stranded directories while keeping match ancestors", () => {
    const tree = makeTree(full);
    tree.batch(fileRemovals(full, matches));
    const dirOps = directoryRemovalOps(full, matches).filter((op) =>
      tree.getItem(op.path),
    );
    if (dirOps.length > 0) tree.batch(dirOps);
    // Dead subtrees gone:
    expect(tree.getItem(".claude/")).toBeNull();
    expect(tree.getItem(".codex/")).toBeNull();
    expect(tree.getItem("docs/proposals/")).toBeNull();
    // Match ancestors and the match itself preserved:
    expect(tree.getItem("docs/")).not.toBeNull();
    expect(tree.getItem("docs/plans/")).not.toBeNull();
    expect(tree.getItem("docs/plans/keep.html")).not.toBeNull();
    tree.cleanUp();
  });

  it("leaves a surviving match-directory's collapse state untouched (no collapse pass)", () => {
    const tree = makeTree(full);
    dirHandle(tree, "docs/plans/")?.collapse();
    expect(dirHandle(tree, "docs/plans/")?.isExpanded()).toBe(false);
    tree.batch(fileRemovals(full, matches));
    const dirOps = directoryRemovalOps(full, matches).filter((op) =>
      tree.getItem(op.path),
    );
    if (dirOps.length > 0) tree.batch(dirOps);
    // Pruning files + dead dirs neither re-expands nor collapses the surviving
    // directory — its hand-collapsed state is preserved.
    expect(dirHandle(tree, "docs/plans/")?.isExpanded()).toBe(false);
    tree.cleanUp();
  });
});

describe("ancestorDirectoryPaths — the directory-marker scan", () => {
  it("tolerates a repeated separator without quadratic backtracking", () => {
    // The marker strip used `/\/+$/`, which CodeQL flagged as
    // `js/polynomial-redos`: the engine retries `\/+$` from each slash in the
    // run and rescans it before failing the anchor. Paths arrive from
    // `git ls-files` — from disk, not from us — so their shape is not ours to
    // bound. A 100k-slash tail finishes instantly under the linear scan and
    // would take quadratic time under the old pattern.
    const pathological = `a/b${"/".repeat(100_000)}`;
    const started = performance.now();
    expect(ancestorDirectoryPaths(pathological)).toEqual(["a/"]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("strips one or many trailing slashes identically", () => {
    for (const p of ["a/b/c/", "a/b/c//", "a/b/c///"]) {
      expect(ancestorDirectoryPaths(p)).toEqual(["a/", "a/b/"]);
    }
  });

  it("leaves a slash-free path untouched", () => {
    expect(ancestorDirectoryPaths("a/b/c.ts")).toEqual(["a/", "a/b/"]);
    expect(ancestorDirectoryPaths("top.ts")).toEqual([]);
    expect(ancestorDirectoryPaths("")).toEqual([]);
  });
});
