/** Terminal display info — bundles server metadata with client-derived
 *  decorations (colors, sub-count) and the canonical identity key.
 *  Identity-and-presentation come from `terminalKey()` in `kolu-common`;
 *  this module only adds the decorations. */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import {
  computeTerminalKeys,
  type TerminalKey,
  terminalKey,
} from "kolu-common/terminalKey";

export type TerminalDisplayInfo = {
  /** Deterministic OKLCH hue per repo `group`. Always defined: `group`
   *  is non-null in `terminalKey` (git repoName or cwd basename) and
   *  `assignColors` covers every key passed in. */
  repoColor: string;
  /** Same OKLCH scheme keyed on the branch `label`. Always defined for
   *  the same reason. */
  branchColor: string;
  /** Color for the supplant-rule annotation slot — currently mirrors
   *  `branchColor`, but lives behind its own name so a future tint
   *  policy (theme-aware, intent-vs-branch distinction, …) lands in
   *  one place instead of touching every render site. */
  annotationColor: string;
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
    const repoColor = colors.get(group);
    const branchColor = colors.get(label);
    // `computeTerminalKeys` keys its map by the ids we just passed in,
    // and `assignColors` was just built from these same group/label
    // strings, so every entry has matching values. The skip is
    // defence-in-depth for an unreachable case — the consumer simply
    // gets fewer entries.
    if (!key || !repoColor || !branchColor) continue;
    result.set(id, {
      meta,
      repoColor,
      branchColor,
      annotationColor: branchColor,
      subCount: getSubTerminalIds(id).length,
      key,
    });
  }
  return result;
}
