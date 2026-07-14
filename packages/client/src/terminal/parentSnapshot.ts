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

/** Build the host-tagged parent-map snapshot memo. `buildMap` projects the raw
 *  list into the map each consumer wants (all ids incl. top-level with a nullable
 *  parent, or subs only); the host-tag, `{ host: "", map: new Map() }` seed, and
 *  the `equals` gate (host switch OR membership/parentId change) are owned here so
 *  the two siblings share one construction, not two byte-identical copies. */
export function createHostScopedParentSnapshot<V extends TerminalId | null>(
  rawList: Accessor<TerminalId[]>,
  activeHostKey: () => string,
  buildMap: (ids: TerminalId[]) => Map<TerminalId, V>,
): Accessor<{ host: string; map: Map<TerminalId, V> }> {
  return createMemo<{ host: string; map: Map<TerminalId, V> }>(
    () => ({ host: activeHostKey(), map: buildMap(rawList()) }),
    { host: "", map: new Map<TerminalId, V>() },
    { equals: (a, b) => a.host === b.host && sameParentSnapshot(a.map, b.map) },
  );
}
