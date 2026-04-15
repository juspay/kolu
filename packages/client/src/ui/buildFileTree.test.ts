import { describe, it, expect } from "vitest";
import { buildFileTree, collectDirPaths } from "./buildFileTree";
import type { TreeNode } from "./buildFileTree";
import type { GitChangedFile } from "kolu-common";

const file = (path: string, status = "M" as const): GitChangedFile => ({
  path,
  status,
});

describe("buildFileTree", () => {
  it("returns empty array for no files", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("puts a root-level file at the top level", () => {
    const tree = buildFileTree([file("README.md")]);
    expect(tree).toEqual([
      { kind: "file", name: "README.md", path: "README.md", status: "M" },
    ]);
  });

  it("groups files under directory nodes", () => {
    const tree = buildFileTree([
      file("src/a.ts"),
      file("src/b.ts"),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.kind).toBe("dir");
    expect(tree[0]!.name).toBe("src");
    const dir = tree[0] as Extract<TreeNode, { kind: "dir" }>;
    expect(dir.children).toHaveLength(2);
    expect(dir.children[0]!.name).toBe("a.ts");
    expect(dir.children[1]!.name).toBe("b.ts");
  });

  it("sorts directories before files, alphabetically within each group", () => {
    const tree = buildFileTree([
      file("z.ts"),
      file("a/x.ts"),
      file("b/y.ts"),
      file("a.ts"),
    ]);
    expect(tree.map((n) => n.name)).toEqual(["a", "b", "a.ts", "z.ts"]);
  });

  it("collapses single-child directory chains", () => {
    const tree = buildFileTree([file("a/b/c/d.ts")]);
    expect(tree).toHaveLength(1);
    const dir = tree[0] as Extract<TreeNode, { kind: "dir" }>;
    // a/b/c collapsed into one node
    expect(dir.kind).toBe("dir");
    expect(dir.name).toBe("a/b/c");
    expect(dir.path).toBe("a/b/c");
    expect(dir.children).toHaveLength(1);
    expect(dir.children[0]!.name).toBe("d.ts");
  });

  it("does not collapse when a directory has multiple children", () => {
    const tree = buildFileTree([
      file("a/b/x.ts"),
      file("a/c/y.ts"),
    ]);
    expect(tree).toHaveLength(1);
    const a = tree[0] as Extract<TreeNode, { kind: "dir" }>;
    expect(a.name).toBe("a");
    expect(a.children).toHaveLength(2);
    expect(a.children[0]!.name).toBe("b");
    expect(a.children[1]!.name).toBe("c");
  });

  it("preserves file status", () => {
    const tree = buildFileTree([file("x.ts", "A"), file("y.ts", "D")]);
    const f0 = tree[0] as Extract<TreeNode, { kind: "file" }>;
    const f1 = tree[1] as Extract<TreeNode, { kind: "file" }>;
    expect(f0.status).toBe("A");
    expect(f1.status).toBe("D");
  });
});

describe("collectDirPaths", () => {
  it("collects all directory paths", () => {
    const tree = buildFileTree([
      file("src/a.ts"),
      file("src/utils/b.ts"),
      file("lib/c.ts"),
    ]);
    const paths = collectDirPaths(tree);
    expect(paths).toEqual(new Set(["src", "src/utils", "lib"]));
  });
});
