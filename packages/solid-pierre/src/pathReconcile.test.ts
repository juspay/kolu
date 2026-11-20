import { FileTree as PierreFileTree } from "@pierre/trees";
import { describe, expect, it } from "vitest";
import {
  ancestorDirectoryPaths,
  directoryRemovalOps,
  dropRedundantDirKeys,
  pathDiffOperations,
} from "./pathReconcile";

const remove = (path: string) => ({ type: "remove", path, recursive: true });

describe("mixed inventory: collapsed dir + tracked child (Code-tab freeze repro)", () => {
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

  it("dropRedundantDirKeys strips a collapsed dir that still has inventory children", () => {
    expect(dropRedundantDirKeys(mixed)).toEqual([".claude/a.md"]);
    expect(dropRedundantDirKeys(settled)).toEqual(settled);
  });

  it("pathDiffOperations emits a recursive remove for an orphaned collapsed dir", () => {
    expect(pathDiffOperations([".claude/", "other.ts"], ["other.ts"])).toEqual([
      { type: "remove", path: ".claude/", recursive: true },
    ]);
  });

  it("applies the mixed→settled transition on a real Pierre tree without throwing", () => {
    const tree = makeTree(mixed);
    expect(tree.getItem(".claude/a.md")).not.toBeNull();
    expect(tree.getItem(".claude/")).not.toBeNull();

    expect(() => {
      tree.batch(
        pathDiffOperations(
          dropRedundantDirKeys(mixed),
          dropRedundantDirKeys(settled),
        ),
      );
    }).not.toThrow();
    expect(tree.getItem(".claude/a.md")).not.toBeNull();
    tree.cleanUp();
  });

  it("does not freeze subsequent inventory changes after the collapsed-dir drop", () => {
    let appliedPaths = [...mixed];
    const tree = makeTree(appliedPaths);

    const tryApply = (paths: string[]): boolean => {
      try {
        const next = dropRedundantDirKeys(paths);
        const ops = pathDiffOperations(
          dropRedundantDirKeys(appliedPaths),
          next,
        ).filter(
          (op) =>
            !(
              op.type === "add" &&
              op.path.endsWith("/") &&
              tree.getItem(op.path)
            ),
        );
        if (ops.length > 0) tree.batch(ops);
        const dirOps = directoryRemovalOps(
          dropRedundantDirKeys(appliedPaths),
          next,
        ).filter((op) => tree.getItem(op.path));
        if (dirOps.length > 0) tree.batch(dirOps);
        appliedPaths = next;
        return true;
      } catch {
        return false;
      }
    };

    expect(tryApply(settled)).toBe(true);
    expect(appliedPaths).toEqual(settled);
    expect(tryApply(later)).toBe(true);
    expect(appliedPaths).toEqual(later);
    expect(tree.getItem("src/app.ts")).not.toBeNull();
    tree.cleanUp();
  });

  it("applies the reverse files→collapsed-dir transition without throwing", () => {
    const withFiles = [".claude/a.md"];
    const collapsed = [".claude/"];
    const tree = makeTree(withFiles);
    const prev = dropRedundantDirKeys(withFiles);
    const next = dropRedundantDirKeys(collapsed);
    const pathOps = pathDiffOperations(prev, next).filter(
      (op) =>
        !(op.type === "add" && op.path.endsWith("/") && tree.getItem(op.path)),
    );
    expect(() => {
      if (pathOps.length > 0) tree.batch(pathOps);
      const dirOps = directoryRemovalOps(prev, next).filter((op) =>
        tree.getItem(op.path),
      );
      if (dirOps.length > 0) tree.batch(dirOps);
    }).not.toThrow();
    expect(tree.getItem(".claude/")).not.toBeNull();
    tree.cleanUp();
  });
});

describe("directoryRemovalOps with bare directory keys in next", () => {
  it("does not prune a directory that next still lists as a collapsed key", () => {
    expect(directoryRemovalOps([".claude/a.md"], [".claude/"])).toEqual([]);
  });
});

describe("directoryRemovalOps", () => {
  it("removes nothing when the file set is unchanged", () => {
    const files = ["a/b/c.ts", "a/d.ts"];
    expect(directoryRemovalOps(files, files)).toEqual([]);
  });

  it("removes nothing when the filter clears (next is the full superset)", () => {
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
    expect(directoryRemovalOps(prev, next)).toEqual([remove("a/")]);
  });

  it("keeps a directory that still holds a match alongside a dropped sibling file", () => {
    const prev = ["pkg/match.ts", "pkg/other.ts"];
    const next = ["pkg/match.ts"];
    expect(directoryRemovalOps(prev, next)).toEqual([]);
  });

  it("prunes directories that lost their last match as a filter narrows", () => {
    const prev = ["docs/plans/a.html", "docs/proposals/b.html"];
    const next = ["docs/plans/a.html"];
    expect(directoryRemovalOps(prev, next)).toEqual([
      remove("docs/proposals/"),
    ]);
  });
});

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

  const dirHandle = (tree: PierreFileTree, path: string) => {
    const item = tree.getItem(path);
    return item != null && "isExpanded" in item ? item : null;
  };

  it("Pierre strands emptied directories on a plain file batch (regression baseline)", () => {
    const tree = makeTree(full);
    tree.batch(fileRemovals(full, matches));
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
    expect(tree.getItem(".claude/")).toBeNull();
    expect(tree.getItem(".codex/")).toBeNull();
    expect(tree.getItem("docs/proposals/")).toBeNull();
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
    expect(dirHandle(tree, "docs/plans/")?.isExpanded()).toBe(false);
    tree.cleanUp();
  });
});

describe("ancestorDirectoryPaths — the directory-marker scan", () => {
  it("tolerates a repeated separator without quadratic backtracking", () => {
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
