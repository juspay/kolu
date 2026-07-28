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

/** Stable 32-bit FNV-1a → hue in [0, 360) with full-hash precision.
 *  Identity colour is a pure function of the key string, not of co-set
 *  order — so dock, palette, and restore paint the same repo the same
 *  hue even when their key sets differ. Using the full 32-bit range
 *  (not `% 360`) keeps ordinary names from colliding on exact hues. */
function stableHue(key: string): number {
  // NFC so hue matches monogram for NFD/NFC-equivalent names (macOS paths).
  // Empty / unexpected keys still get a deterministic hue (callers usually
  // only pass non-empty terminalKey group/label strings).
  const s = (key ?? "").normalize("NFC");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 0x1_0000_0000) * 360;
}

/** Assign OKLCH colours from a stable per-key hue. The iterable only
 *  names which keys appear; it does not affect the hue of any key.
 *  Non-string entries are dropped (tests / partial meta can yield them). */
export function assignColors(keys: Iterable<string>): Map<string, string> {
  const unique = [
    ...new Set(
      [...keys].filter((k): k is string => typeof k === "string" && k.length >= 0),
    ),
  ];
  return new Map(
    unique.map((key) => [key, `oklch(0.75 0.14 ${stableHue(key)})`]),
  );
}

/** Build display info for all terminals. Resolves stable per-key colours
 *  (`assignColors` — pure function of each name, not of co-set size),
 *  computes collision-aware identity keys in one pass
 *  (`computeTerminalKeys`), and bundles sub-count. Pure — same inputs
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
    // `computeTerminalKeys` and `assignColors` were just built from these
    // same ids/group/label strings — a miss is a programmer bug, not a
    // soft skip. Fail loud so a broken projection never silently drops a
    // terminal's decorations.
    if (!key || !repoColor || !annotationColor) {
      throw new Error(
        `buildTerminalDisplayInfos invariant: missing key/colour for terminal ${id} (group=${group}, label=${label})`,
      );
    }
    result.set(id, {
      repoColor,
      annotationColor,
      subCount: getSubTerminalIds(id).length,
      key,
    });
  }
  return result;
}
