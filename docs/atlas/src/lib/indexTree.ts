import type { CollectionEntry } from "astro:content";

// Shared note-edge primitives: how `parents` resolves to edges, how a note id
// projects to a renderable ref, and the pinned title collation. Used by both the
// backlink graph (lib/atlasGraph) and the graph layout (lib/graphView) so they
// agree on what an edge is. (There is no categorical tree anymore — an index is
// just a note marked `moc: true`; see content.config.ts.)

/** A clickable reference to another note — rendered as a relative `./<id>.html`
 *  anchor with the title as link text. Shared by the graph view and the backlink
 *  graph (lib/atlasGraph), which denote the same concept. */
export interface NoteRef {
  id: string;
  title: string;
}

/** Normalize the `parents` frontmatter (one slug, a list, or absent) to a list.
 *  Shared with the backlink graph (lib/atlasGraph) so both views read `parents`
 *  the same way. */
export const toParents = (p: string | string[] | undefined): string[] =>
  p === undefined ? [] : Array.isArray(p) ? p : [p];

/** Resolve a note's `parents` to the ids of the notes it actually edges to: drop
 *  self-references and parents that name no existing note. The edge semantics —
 *  "a `parents` entry whose target exists is an edge; self/missing drops" — live
 *  here once, so the graph view and the backlink graph agree on what an edge is. */
export const resolveParents = (
  noteById: Map<string, CollectionEntry<"atlas">>,
  note: CollectionEntry<"atlas">,
): string[] =>
  toParents(note.data.parents).filter(
    (pid) => pid !== note.id && noteById.has(pid),
  );

// Pin the collation locale so the build is idempotent across machines — a bare
// localeCompare() follows the host's LANG/LC_COLLATE, which would reorder titles
// (and churn the committed dist) on a differently-configured box.
export const titleCmp = (a: string, b: string) => a.localeCompare(b, "en-US");

/** Project a note id to its renderable {id, title} ref via the id→note map.
 *  Shared by the graph view and the backlink graph, which build the same ref the
 *  same way. */
export const toRef = (
  byId: Map<string, CollectionEntry<"atlas">>,
  id: string,
): NoteRef => ({ id, title: byId.get(id)!.data.title });
