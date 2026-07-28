/** Terminal display info — client-derived decorations (colors, sub-count)
 *  and the canonical identity key. Identity-and-presentation come from
 *  `terminalKey()` in `kolu-common`; this module only adds the decorations.
 *
 *  Deliberately carries NO live `TerminalMetadata`. This value rides the
 *  `displayInfos` memo, which is invalidated only by git / cwd / membership
 *  (`terminalKey`'s inputs), NOT by the fast-changing per-terminal facts
 *  (pr / agent / foreground / state). Bundling `meta` here once let a
 *  consumer read those live fields off a snapshot the memo never refreshes,
 *  so the value went stale (the header lagged the dock on PR — the class this
 *  removal makes unspellable). Live fields come from `getMetadata(id)`, the
 *  fine-grained store proxy, at each consumer's own leaf. */

import type { TerminalMetadata } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
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
  /** Paint for the annotation slot (branch / intent line) — same OKLCH
   *  scheme keyed on the branch `label`. One socket only; do not add a
   *  parallel `branchColor` twin. */
  annotationColor: string;
  subCount: number;
  /** Collision-aware identity key. `suffix` is set only when another
   *  terminal in the same display set shares `(group, label)`. */
  key: TerminalKey;
};

/** The both-present gate for a terminal's display row: the slow `info`
 *  decorations paired with the live `meta` record, or `null` until BOTH
 *  arrive. This is the single source of truth for that pairing — the dock
 *  factory (`createDockRowData`), the title-bar header, the mobile handle, and
 *  `buildWorkspaceEntries` all gate through it, so no consumer re-spells the
 *  `info && meta` check. Wrapped in a `createMemo` by the reactive consumers, it
 *  recomputes only when either REFERENCE turns over (not on a per-leaf tick);
 *  the fine-grained pr/agent/foreground reads happen at the leaf, off the live
 *  `meta` proxy. Lives HERE, not in `useTerminalStore` — it is a pure
 *  `(info, meta)` function that touches no store, so it belongs in the leaf
 *  module every consumer already imports (a `dockModel` / `CanvasMinimap`
 *  consumer must not invert its dependency up into the store to reach it). */
export function pairDisplayRow(
  info: TerminalDisplayInfo | undefined,
  meta: TerminalMetadata | undefined,
): { info: TerminalDisplayInfo; meta: TerminalMetadata } | null {
  return info && meta ? { info, meta } : null;
}

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
  for (const { id, group, label } of entries) {
    const key = keys.get(id);
    const repoColor = colors.get(group);
    const annotationColor = colors.get(label);
    // `computeTerminalKeys` keys its map by the ids we just passed in,
    // and `assignColors` was just built from these same group/label
    // strings, so every entry has matching values. The skip is
    // defence-in-depth for an unreachable case — the consumer simply
    // gets fewer entries.
    if (!key || !repoColor || !annotationColor) continue;
    result.set(id, {
      repoColor,
      annotationColor,
      subCount: getSubTerminalIds(id).length,
      key,
    });
  }
  return result;
}
