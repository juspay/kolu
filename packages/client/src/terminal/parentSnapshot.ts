import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";

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
