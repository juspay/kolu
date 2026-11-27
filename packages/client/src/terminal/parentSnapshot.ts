/** The host-scoped parent-tree snapshot — the ONE construction both the departure
 *  reconcile (`useActiveReconcile`) and the arrival adopt (`useAdoptNewSplit`)
 *  derive from. A `createMemo` over the raw list, tagged with the active host and
 *  gated so it wakes only on a membership/parentId change or a host switch. The
 *  two siblings differ only in their map PROJECTION (reconcile keeps every id with
 *  a nullable parent for switch-target order; adopt keeps subs only), passed in as
 *  `buildMap` — the host-tag, seed, and `equals` gate live here once, so neither
 *  hook re-implements the wrapper and neither depends on the other. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { foldEach } from "../wideFold";

/** Whether two parent-snapshots are identical — same ids, same order, same
 *  parentId each. The `equals` gate on the snapshot memo below, so a metadata
 *  change that touches neither membership nor any parentId (the common case) does
 *  not wake either consumer. Order-sensitive to match `terminalIds`. Read-only
 *  (`ReadonlyMap`) so both a nullable all-ids map (reconcile) and a never-null
 *  sub-only map (adopt) compare through one home. */
export function sameParentSnapshot(
  a: ReadonlyMap<TerminalId, TerminalId | null>,
  b: ReadonlyMap<TerminalId, TerminalId | null>,
): boolean {
  if (a.size !== b.size) return false;
  const bIter = b.entries();
  for (const [k, v] of a) {
    const next = bIter.next().value;
    if (next === undefined || next[0] !== k || next[1] !== v) return false;
  }
  return true;
}

/** One terminal's live parent edge: `undefined` when its record is absent or
 *  parked (so a dangling parentId cannot invent a fake root), `null` for a
 *  top-level tile, else the parent's id. A row of the fold below, which is
 *  where the edge is actually READ — each consumer's `buildMap` then projects
 *  plain data. */
export interface ParentEdgeRow {
  readonly id: TerminalId;
  readonly parent: TerminalId | null | undefined;
}

/** Build the host-tagged parent-map snapshot memo. `parentOf` is the live edge;
 *  `buildMap` projects the folded edges into the map each consumer wants (all
 *  ids incl. top-level with a nullable parent, or subs only). The host-tag and
 *  the `equals` gate (host switch OR membership/parentId change) are owned here
 *  so the two siblings share one construction, not two byte-identical copies.
 *
 *  The edges are read ONE TERMINAL AT A TIME ({@link foldEach}): an edge costs
 *  two store nodes, so a snapshot that read the fleet itself was subscribed to
 *  500 sources at 250 panes — `WIDE_SCOPE_DEPS`, which Solid's development
 *  build raises past 200. What this memo reads is the joined list, plus the
 *  host key. */
export function createHostScopedParentSnapshot<V extends TerminalId | null>(
  /** The snapshot's name in dev diagnostics. Its rows are `<name>.edge.row`. */
  name: string,
  rawList: Accessor<readonly TerminalId[]>,
  activeHostKey: () => string,
  parentOf: (id: TerminalId) => TerminalId | null | undefined,
  buildMap: (edges: ReadonlyArray<ParentEdgeRow>) => Map<TerminalId, V>,
): Accessor<{ host: string; map: Map<TerminalId, V> }> {
  const edges = foldEach(
    `${name}.edge`,
    rawList,
    (id): ParentEdgeRow => ({ id, parent: parentOf(id) }),
    (a, b) => a.id === b.id && a.parent === b.parent,
  );
  // No seed: the memo's first value IS the first snapshot, and the `equals`
  // gate (host switch OR a membership/parentId change) decides every run after
  // it. The retired empty-snapshot seed only ever compared equal to an empty
  // first run, which carries the same facts.
  return createMemo<{ host: string; map: Map<TerminalId, V> }>(
    () => ({ host: activeHostKey(), map: buildMap(edges()) }),
    {
      name,
      equals: (a, b) => a.host === b.host && sameParentSnapshot(a.map, b.map),
    },
  );
}
