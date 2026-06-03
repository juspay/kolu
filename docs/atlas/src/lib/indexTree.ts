import type { CollectionEntry } from "astro:content";

export interface TreeNode {
  note: CollectionEntry<"atlas">;
  children: TreeNode[];
}

const toParents = (p: string | string[] | undefined): string[] =>
  p === undefined ? [] : Array.isArray(p) ? p : [p];

/** Build a parent→children forest from flat notes. `data.parents` lists note ids
 *  (flat slugs); a note can list several, so it appears under EACH parent. A
 *  note with no valid parent (missing / self / filtered-out, e.g. a draft) is a
 *  root — nothing is ever unfiled. The result is a DAG of shared node objects;
 *  the renderer (IndexTree) breaks cycles with an ancestor-path guard, and so
 *  does the reachability check here. Children + roots are title-sorted. */
export function buildNoteTree(notes: CollectionEntry<"atlas">[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>(
    notes.map((n) => [n.id, { note: n, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const n of notes) {
    const node = nodes.get(n.id)!;
    const parentIds = toParents(n.data.parents).filter(
      (pid) => pid !== n.id && nodes.has(pid),
    );
    if (parentIds.length === 0) roots.push(node);
    else for (const pid of parentIds) nodes.get(pid)!.children.push(node);
  }

  // Promote any note unreachable from a root (a pure parent cycle) so it still
  // shows. The path set breaks cycles the same way the renderer does.
  const reachable = new Set<string>();
  const walk = (node: TreeNode, path: Set<string>): void => {
    if (reachable.has(node.note.id) || path.has(node.note.id)) return;
    reachable.add(node.note.id);
    const next = new Set(path).add(node.note.id);
    for (const c of node.children) walk(c, next);
  };
  for (const r of roots) walk(r, new Set());
  for (const n of notes) {
    if (!reachable.has(n.id)) roots.push(nodes.get(n.id)!);
  }

  const byTitle = (a: TreeNode, b: TreeNode) =>
    a.note.data.title.localeCompare(b.note.data.title);
  for (const node of nodes.values()) node.children.sort(byTitle);
  roots.sort(byTitle);
  return roots;
}
