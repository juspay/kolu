/** Terminal display info — client-derived decorations (colors, sub-count,
 *  the title an export carries) and the canonical identity key.
 *  Identity-and-presentation come from `terminalKey()` / `terminalCaption()`
 *  in `@kolu/terminal-vocab`; this module only adds the decorations.
 *
 *  Deliberately carries NO live `TerminalMetadata`. This value rides the
 *  `displayInfos` memo, which is invalidated only by git / cwd / membership
 *  (`terminalKey`'s inputs), NOT by the fast-changing per-terminal facts
 *  (pr / agent / foreground / state). Bundling `meta` here once let a
 *  consumer read those live fields off a snapshot the memo never refreshes,
 *  so the value went stale (the header lagged the dock on PR — the class this
 *  removal makes unspellable). Live fields come from `getMetadata(id)`, the
 *  fine-grained store proxy, at each consumer's own leaf. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { identityColor } from "@kolu/solid-dockrow/rowValues";
import {
  computeTerminalKeys,
  type TerminalKey,
  terminalCaption,
  terminalKey,
} from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";

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
 *  Dock row-data factory, the title-bar header, the mobile handle, and
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

/** The title a client-side EXPORT of one terminal carries — the PNG copied to
 *  the clipboard and the PDF printed from the scrollback.
 *
 *  One helper because there is one terminal: the two exports composed this
 *  string separately and had already parted, so the same terminal printed as
 *  "Terminal" and copied as "terminal" whenever its metadata had not arrived.
 *  The composition itself is NOT here — it is `terminalCaption`, in
 *  `@kolu/terminal-vocab`, which padi's daemon-side PNG reads too. So the
 *  browser's picture and the agent's picture caption a terminal identically by
 *  construction, not by two files being kept in agreement.
 *
 *  What IS here is the only thing the client has and padi does not: metadata
 *  that has not arrived yet. FALLBACK KEPT: the screenshot's lowercase
 *  "terminal", not the PDF's "Terminal" — it sits in the same title bar as the
 *  lowercase `kolu` wordmark, and every real caption it stands in for (a repo
 *  name, a directory name) is lowercase-as-spelled rather than title-cased. */
export function terminalExportTitle(
  meta: TerminalMetadata | undefined,
): string {
  return meta ? terminalCaption(meta) : "terminal";
}

/** Assign OKLCH colours from a stable per-key hue. The iterable only
 *  names which keys appear; it does not affect the hue of any key.
 *  Non-string entries are dropped (tests / partial meta can yield them).
 *
 *  The HUE FORMULA is not here: `identityColor` is
 *  `@kolu/solid-dockrow/rowValues`', because the row renders what it paints and
 *  a consumer feeding the row's `labelColor` needs the same answer for one key.
 *  What stays here is the co-set shape kolu's own call sites want — a `Map` over
 *  the keys on screen — built by calling that one function per key, so "the
 *  colour is a function of the key ALONE, never of which keys share the screen"
 *  is true by construction rather than by two implementations agreeing. */
export function assignColors(keys: Iterable<string>): Map<string, string> {
  const unique = [
    ...new Set([...keys].filter((k): k is string => typeof k === "string")),
  ];
  return new Map(unique.map((key) => [key, identityColor(key)]));
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
  /** Every PANE of the tile — the whole subtree, not the one-hop children. The
   *  split badge counts what the canvas tab strip shows, so a grandchild
   *  counts; a one-hop reader here silently undercounts a nested tile. */
  getPaneIds: (id: TerminalId) => TerminalId[],
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
      subCount: getPaneIds(id).length,
      key,
    });
  }
  return result;
}
