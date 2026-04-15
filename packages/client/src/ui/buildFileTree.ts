import type { GitChangedFile, GitChangeStatus } from "kolu-common";

/** A file leaf in the tree. */
export type FileNode = {
  kind: "file";
  name: string;
  path: string;
  status: GitChangeStatus;
};

/** A directory branch in the tree. */
export type DirNode = {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
};

export type TreeNode = FileNode | DirNode;

/** Build a hierarchical tree from a flat list of changed files.
 *
 *  - Groups files by path segments into nested directories.
 *  - Sorts directories first, then files, alphabetically within each group.
 *  - Auto-collapses single-child directory chains (VS Code style):
 *    `packages/server/src` becomes one node when each intermediate
 *    directory has exactly one child and that child is also a directory. */
export function buildFileTree(files: GitChangedFile[]): TreeNode[] {
  // Intermediate mutable structure for building.
  type MutableDir = {
    children: Map<string, MutableDir>;
    files: Map<string, GitChangedFile>;
  };

  const root: MutableDir = { children: new Map(), files: new Map() };

  for (const file of files) {
    const segments = file.path.split("/");
    let current = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (!current.children.has(seg)) {
        current.children.set(seg, { children: new Map(), files: new Map() });
      }
      current = current.children.get(seg)!;
    }
    current.files.set(segments.at(-1)!, file);
  }

  function toTreeNodes(dir: MutableDir, prefix: string): TreeNode[] {
    const dirs: DirNode[] = [];
    const leaves: FileNode[] = [];

    for (const [name, child] of [...dir.children.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const path = prefix ? `${prefix}/${name}` : name;
      const children = toTreeNodes(child, path);
      dirs.push({ kind: "dir", name, path, children });
    }

    for (const [name, file] of [...dir.files.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      leaves.push({ kind: "file", name, path: file.path, status: file.status });
    }

    return [...dirs, ...leaves];
  }

  return collapseChains(toTreeNodes(root, ""));
}

/** Recursively collapse single-child directory chains.
 *  `a/` → `b/` → `c/` → [files] becomes `a/b/c/` → [files]. */
function collapseChains(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.kind === "file") return node;
    const collapsed = collapseChains(node.children);
    const only = collapsed.length === 1 ? collapsed[0]! : null;
    if (only?.kind === "dir") {
      return {
        kind: "dir" as const,
        name: `${node.name}/${only.name}`,
        path: only.path,
        children: only.children,
      };
    }
    return { ...node, children: collapsed };
  });
}

/** Collect all directory paths in a tree (for default-expand-all). */
export function collectDirPaths(nodes: TreeNode[]): Set<string> {
  const paths = new Set<string>();
  const walk = (n: TreeNode) => {
    if (n.kind === "dir") {
      paths.add(n.path);
      n.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return paths;
}
