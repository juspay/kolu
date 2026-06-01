import { FileTree as PierreFileTree } from "@pierre/trees";
import { describe, expect, it } from "vitest";
import { directoryRemovalOps } from "./pathReconcile";

const remove = (path: string) => ({ type: "remove", path, recursive: true });

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
    for (const op of directoryRemovalOps(full, matches)) {
      if (tree.getItem(op.path)) tree.batch([op]);
    }
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
    for (const op of directoryRemovalOps(full, matches)) {
      if (tree.getItem(op.path)) tree.batch([op]);
    }
    // Pruning files + dead dirs neither re-expands nor collapses the surviving
    // directory — its hand-collapsed state is preserved.
    expect(dirHandle(tree, "docs/plans/")?.isExpanded()).toBe(false);
    tree.cleanUp();
  });
});
