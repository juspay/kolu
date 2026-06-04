import type { CollectionEntry } from "astro:content";

export type Category = "bug" | "feature" | "analysis" | "reference";

/** Category is the index's primary skeleton: one section per category, in this
 *  order. `parents` only nests notes *within* a category. */
export const CATEGORY_ORDER: Category[] = [
  "bug",
  "feature",
  "analysis",
  "reference",
];

export const CATEGORY_META: Record<Category, { label: string; blurb: string }> =
  {
    bug: { label: "Bugs", blurb: "Diagnosed defects and their fix direction." },
    feature: {
      label: "Features",
      blurb: "Proposed capabilities, not yet built.",
    },
    analysis: {
      label: "Analysis",
      blurb: "Investigations into how the system behaves.",
    },
    reference: {
      label: "Reference",
      blurb: "Durable knowledge — designs, decisions, how it works.",
    },
  };

export interface CatTreeNode {
  note: CollectionEntry<"atlas">;
  /** Children whose category matches this note's — the within-section hierarchy. */
  children: CatTreeNode[];
  /** Cross-category parents, dropped from the tree and surfaced as related links. */
  related: { id: string; title: string }[];
}

export interface CategoryGroup {
  category: Category;
  label: string;
  blurb: string;
  roots: CatTreeNode[];
  count: number;
}

const toParents = (p: string | string[] | undefined): string[] =>
  p === undefined ? [] : Array.isArray(p) ? p : [p];

// Pin the collation locale so the build is idempotent across machines — a bare
// localeCompare() follows the host's LANG/LC_COLLATE, which would reorder the
// index (and churn the committed dist) on a differently-configured box.
const titleCmp = (a: string, b: string) => a.localeCompare(b, "en-US");

/** Group notes into category sections, nesting `parents` edges *within* a
 *  category (same `kind`). A parent in a different category isn't a tree edge —
 *  it's surfaced as a `related` link instead, so the topical connection survives
 *  without tearing the categorical sections apart. Within a category a note with
 *  no same-category parent is a root; nothing is ever unfiled. Cycle-safe (a
 *  pure same-category parent cycle is promoted to a root) and title-sorted. */
export function buildCategoryGroups(
  notes: CollectionEntry<"atlas">[],
): CategoryGroup[] {
  const noteById = new Map(notes.map((n) => [n.id, n]));
  const nodes = new Map<string, CatTreeNode>(
    notes.map((n) => [n.id, { note: n, children: [], related: [] }]),
  );
  const rootsByCat = new Map<Category, CatTreeNode[]>();
  const rootsFor = (c: Category) => {
    let r = rootsByCat.get(c);
    if (!r) rootsByCat.set(c, (r = []));
    return r;
  };

  for (const n of notes) {
    const node = nodes.get(n.id)!;
    const cat = n.data.kind as Category;
    const parentIds = toParents(n.data.parents).filter(
      (pid) => pid !== n.id && noteById.has(pid),
    );
    const sameCat = parentIds.filter(
      (pid) => noteById.get(pid)!.data.kind === cat,
    );
    node.related = parentIds
      .filter((pid) => noteById.get(pid)!.data.kind !== cat)
      .map((pid) => ({ id: pid, title: noteById.get(pid)!.data.title }))
      .sort((a, b) => titleCmp(a.title, b.title));
    if (sameCat.length === 0) rootsFor(cat).push(node);
    else for (const pid of sameCat) nodes.get(pid)!.children.push(node);
  }

  // Promote any note unreachable from a same-category root (a parent cycle) so
  // it still shows. The path set breaks cycles the same way the renderer does.
  const reachable = new Set<string>();
  const walk = (node: CatTreeNode, path: Set<string>): void => {
    if (reachable.has(node.note.id) || path.has(node.note.id)) return;
    reachable.add(node.note.id);
    const next = new Set(path).add(node.note.id);
    for (const c of node.children) walk(c, next);
  };
  for (const roots of rootsByCat.values())
    for (const r of roots) walk(r, new Set());
  for (const n of notes) {
    if (!reachable.has(n.id))
      rootsFor(n.data.kind as Category).push(nodes.get(n.id)!);
  }

  const byTitle = (a: CatTreeNode, b: CatTreeNode) =>
    titleCmp(a.note.data.title, b.note.data.title);
  for (const node of nodes.values()) node.children.sort(byTitle);

  const groups: CategoryGroup[] = [];
  for (const cat of CATEGORY_ORDER) {
    const roots = (rootsByCat.get(cat) ?? []).sort(byTitle);
    if (roots.length === 0) continue;
    groups.push({
      category: cat,
      label: CATEGORY_META[cat].label,
      blurb: CATEGORY_META[cat].blurb,
      roots,
      count: notes.filter((n) => n.data.kind === cat).length,
    });
  }
  return groups;
}
