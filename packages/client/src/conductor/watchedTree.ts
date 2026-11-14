/** THE SHAPE OF A PIECE OF WORK — which watched terminal sits under which, and
 *  in what order the group's rows are drawn.
 *
 *  A waterfall is a planner with an implementor split inside it. kolu-server
 *  already walks the `child-of` edges to decide WHICH terminals belong to one
 *  piece of work (it is the only place that walk can honestly happen — see the
 *  panel's header), but it publishes the members FLAT, in watch order. Drawn
 *  flat they read as two unrelated terminals that happen to share a heading,
 *  which is exactly what the human saw: a planner and a raw uuid beside it.
 *  So the panel draws the edge it already has rather than flattening it.
 *
 *  THE EDGE IS THE LIVE RECORD'S, not the server's grouping: a terminal's
 *  `parentId`, read off the same standing the row already reads. That is why
 *  the nesting can be WEAKER than the grouping — the server keeps a piece of
 *  work together for a host that is away, and this browser has no record to
 *  read a parent out of there. A row whose parent cannot be established that
 *  way (host away, terminal gone, parent not watched, parent in another group)
 *  sits at the top of the group in watch order. The grouping survives; only
 *  the indentation goes, and a flat row is the honest drawing of an edge
 *  nothing here can see.
 *
 *  PURE, and given the edge as a function: the panel reads it from Solid, the
 *  test hands it a map. The ordering rules are the whole of what this module
 *  knows, so they can be pinned without mounting anything. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { splitWatchedRef } from "./watchedRef";

/** One drawn row: the ref, how deep it sits, and the watched ref it is drawn
 *  under (`null` at the top of its group). */
export interface WatchedTreeRow {
  readonly ref: string;
  readonly depth: number;
  readonly parent: string | null;
}

/** The parent of a watched terminal as a REF — its `parentId` on the host it
 *  is already on. The host half is the child's own: padi's `child-of` edge
 *  cannot cross a machine (a split lives inside its parent's tile), so there
 *  is no second host to read and no ambiguity to resolve. `null` for a record
 *  with no parent (a top-level tile) or a ref this browser cannot parse. */
export function watchedParentRef(
  ref: string,
  meta: TerminalMetadata,
): string | null {
  const split = splitWatchedRef(ref);
  const parent = meta.parentId;
  if (split === null || parent === undefined) return null;
  return fleetTerminalRef(split.host, parent);
}

/** The group's rows in TREE order: each terminal before the splits under it,
 *  depth first, siblings in watch order, the group's own root first.
 *
 *  `root` is the piece of work's top-level terminal, which is not necessarily
 *  watched itself and not necessarily the first ref (a split can be added to
 *  the watch list before the planner above it). When it IS watched it heads
 *  the group, because that is what the group is called.
 *
 *  CYCLE-SAFE because the edge is published data: `parentId` is written by the
 *  client that created the split and arrives over a wire, and a drawing loop
 *  (or a dropped row) would be the panel's own crash rather than a bad record
 *  being drawn as what it is. A terminal that reaches itself by walking up
 *  loses its edge and is drawn at the top of the group — every ref handed in
 *  comes back exactly once, which is the property the panel relies on to be a
 *  true reading of the watch list. */
export function watchedTreeRows(
  refs: readonly string[],
  root: string,
  parentOf: (ref: string) => string | null,
): WatchedTreeRow[] {
  /** Watch order, and membership in one read — a row's parent counts only
   *  when it is watched in THIS group. */
  const watched = new Set(refs);
  const parent = new Map<string, string | null>();
  for (const ref of refs) {
    const above = parentOf(ref);
    parent.set(
      ref,
      above !== null && above !== ref && watched.has(above) ? above : null,
    );
  }
  // A cycle is broken at the row that found it: it goes to the top of the
  // group, which leaves the rest of the loop hanging off a row that is now
  // drawn, so every member still appears exactly once.
  for (const ref of refs) {
    const seen = new Set([ref]);
    let above = parent.get(ref) ?? null;
    while (above !== null) {
      if (seen.has(above)) {
        parent.set(ref, null);
        break;
      }
      seen.add(above);
      above = parent.get(above) ?? null;
    }
  }

  const children = new Map<string, string[]>();
  const tops: string[] = [];
  for (const ref of refs) {
    const above = parent.get(ref) ?? null;
    if (above === null) {
      tops.push(ref);
      continue;
    }
    const siblings = children.get(above);
    if (siblings === undefined) children.set(above, [ref]);
    else siblings.push(ref);
  }
  // The root heads its own group when it is watched; the other top-level rows
  // keep watch order behind it.
  const ordered = watched.has(root)
    ? [root, ...tops.filter((ref) => ref !== root)]
    : tops;

  // Every ref is reachable: the break pass leaves the edges acyclic, so
  // walking up from any row ends at a top-level one, and the walk below
  // visits every descendant of every top. `drawn` is therefore a guard
  // against drawing a row twice, not a net under dropped rows — a ref that
  // needed catching afterwards would mean the break pass was wrong, and
  // catching it quietly is how that stays unnoticed.
  const rows: WatchedTreeRow[] = [];
  const drawn = new Set<string>();
  const walk = (ref: string, depth: number): void => {
    if (drawn.has(ref)) return;
    drawn.add(ref);
    rows.push({ ref, depth, parent: parent.get(ref) ?? null });
    for (const child of children.get(ref) ?? []) walk(child, depth + 1);
  };
  for (const top of ordered) walk(top, 0);
  return rows;
}
