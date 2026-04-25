/** Pill-tree ordering — group terminals by repo, sort spatially when
 *  layouts are available so the tree visually mirrors the canvas
 *  (leftmost tile = first pill, rightmost tile = last pill). Single
 *  source for both `PillTree` visualization and the mobile swipe-cycle
 *  handler so the two views never diverge. */

import type { TerminalId } from "kolu-common";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { TileLayout } from "./TileLayout";

export interface PillBranch {
  id: TerminalId;
  /** Display label — branch name when known, falls back to terminal name. */
  label: string;
  /** Short id-prefix suffix ("#a3f2") shown after the label when this
   *  terminal collides on identity with another (same repo+branch, or
   *  same cwd for non-git). Derived client-side from the live terminal
   *  set via `computeTerminalKeys`. */
  suffix?: string;
}

export interface PillRepoGroup {
  repoName: string;
  branches: PillBranch[];
}

/** Group ids by repoName (or cwd basename for non-git terminals).
 *
 *  When `getLayout` is provided AND a tile has a saved layout, branches
 *  inside each repo sort by canvas x (then y as tie-break), and repos
 *  themselves sort by the min-x of their branches — so the pill tree
 *  reads left-to-right exactly as tiles sit on the canvas. Tiles
 *  without a layout (yet) and the no-layout caller (mobile, where
 *  there is no canvas) fall back to the caller's input order, which
 *  is the server's canonical Map insertion order. */
export function groupByRepo(
  ids: TerminalId[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  getLayout?: (id: TerminalId) => TileLayout | undefined,
): PillRepoGroup[] {
  // `Map` preserves insertion order, so this single structure is the
  // sole source of truth for both grouping and traversal order.
  const groups = new Map<string, PillRepoGroup>();
  // Per-id layout cached for sort comparisons — undefined when no
  // layout yet OR when the caller didn't provide `getLayout`.
  const layoutOf = new Map<TerminalId, TileLayout | undefined>();
  // Per-repo min-x for sorting groups themselves.
  const repoMinX = new Map<string, number>();

  for (const id of ids) {
    const info = getDisplayInfo(id);
    if (!info) continue;
    const groupKey = info.key.group;
    let group = groups.get(groupKey);
    if (!group) {
      group = { repoName: groupKey, branches: [] };
      groups.set(groupKey, group);
    }
    group.branches.push({
      id,
      label: info.key.label,
      suffix: info.key.suffix,
    });
    if (getLayout) {
      const layout = getLayout(id);
      layoutOf.set(id, layout);
      if (layout) {
        const prev = repoMinX.get(groupKey);
        if (prev === undefined || layout.x < prev) {
          repoMinX.set(groupKey, layout.x);
        }
      }
    }
  }

  if (!getLayout) return [...groups.values()];

  // Spatial sort. Tiles without a layout sort to the END of their
  // repo group (using +Infinity); repos with no laid-out tiles sort
  // to the end (using +Infinity). Ties broken by input array order via
  // the pre-existing array order — `sort` is stable in modern engines.
  for (const group of groups.values()) {
    group.branches.sort((a, b) => {
      const ax = layoutOf.get(a.id)?.x ?? Infinity;
      const bx = layoutOf.get(b.id)?.x ?? Infinity;
      if (ax !== bx) return ax - bx;
      const ay = layoutOf.get(a.id)?.y ?? Infinity;
      const by = layoutOf.get(b.id)?.y ?? Infinity;
      return ay - by;
    });
  }
  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        (repoMinX.get(a) ?? Infinity) - (repoMinX.get(b) ?? Infinity),
    )
    .map(([, group]) => group);
}

/** Flat traversal of the grouped order — used by mobile swipe to cycle
 *  through tiles in the same sequence the pill tree would walk. */
export function flatPillOrder(groups: PillRepoGroup[]): TerminalId[] {
  return groups.flatMap((g) => g.branches.map((b) => b.id));
}

/** Stable repo color: first branch in the group whose terminal has a
 *  display color (any terminal with git context contributes one). Falls
 *  back to the accent variable. Shared between PillTree (desktop) and
 *  MobileChromeSheet so the two surfaces don't drift on color choice. */
export function repoColor(
  group: PillRepoGroup,
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
): string {
  for (const b of group.branches) {
    const c = getDisplayInfo(b.id)?.repoColor;
    if (c) return c;
  }
  return "var(--color-accent)";
}
