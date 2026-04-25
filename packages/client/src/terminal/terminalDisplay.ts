/** Terminal display info — bundles server metadata with client-derived
 *  decorations (colors, sub-count) and the canonical identity key.
 *  Identity-and-presentation come from `terminalKey()` in `kolu-common`;
 *  this module only adds the decorations. */

import {
  computeTerminalKeys,
  terminalKey,
  type TerminalId,
  type TerminalKey,
  type TerminalMetadata,
} from "kolu-common";

export type TerminalDisplayInfo = {
  repoColor?: string;
  branchColor?: string;
  meta: TerminalMetadata;
  subCount: number;
  /** Collision-aware identity key. `suffix` is set only when another
   *  terminal in the same display set shares `(group, label)`. */
  key: TerminalKey;
};

/** Assign OKLCH colors via golden-angle hue spacing.
 *  All keys share one sequence so no two get the same color. */
export function assignColors(keys: Iterable<string>): Map<string, string> {
  return new Map(
    [...new Set(keys)]
      .sort()
      .map((key, i) => [key, `oklch(0.75 0.14 ${(i * 137.508) % 360})`]),
  );
}

/** Build display info for all terminals. Resolves colors from the full
 *  terminal list (global hue uniqueness), computes collision-aware
 *  identity keys in one pass (`computeTerminalKeys`), and bundles
 *  sub-count so consumers get one complete object. Pure — same inputs
 *  produce the same outputs on every client, so suffixes stay in sync
 *  without server broadcast. */
export function buildTerminalDisplayInfos(
  ids: TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  getSubTerminalIds: (id: TerminalId) => TerminalId[],
): Map<TerminalId, TerminalDisplayInfo> {
  const entries = ids.flatMap((id) => {
    const meta = getMeta(id);
    return meta ? [{ id, meta, ...terminalKey(meta) }] : [];
  });
  const colors = assignColors(
    entries.flatMap(({ group, label }) => [group, label]),
  );
  const keys = computeTerminalKeys(
    entries.map(({ id, meta }) => ({ id, git: meta.git, cwd: meta.cwd })),
  );
  const result = new Map<TerminalId, TerminalDisplayInfo>();
  for (const { id, meta, group, label } of entries) {
    const key = keys.get(id);
    // `computeTerminalKeys` keys its map by the ids we just passed in,
    // so every entry has a matching key. The skip is defence-in-depth
    // for an unreachable case — the consumer simply gets fewer entries.
    if (!key) continue;
    result.set(id, {
      meta,
      repoColor: colors.get(group),
      branchColor: colors.get(label),
      subCount: getSubTerminalIds(id).length,
      key,
    });
  }
  return result;
}
