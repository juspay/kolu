/** Project the flat ranked-row list into the dock's repo → branch
 *  hierarchy. Pure: same inputs produce the same outputs on every render.
 *
 *  Top-level groups are repos (or cwd-basename for non-git terminals).
 *  Repos with two or more distinct branches grow a nested branch-header
 *  layer; single-branch repos collapse to one `"REPO · branch"` header so
 *  the common case stays compact.
 *
 *  Within a leaf, terminal rows preserve the input `ranked` order — that
 *  list is already recency- and bucket-sorted by `rankDockRows`, and
 *  re-sorting here would fight that decision. Across groups, ordering is
 *  max-recency descending, so the most-recently-active repo (and within
 *  it, the most-recently-active branch) leads the dock.
 *
 *  `flattenTerminalIds` is the canonical depth-first walk that drives
 *  `Cmd+1..9` — folded groups still contribute their children to the
 *  walk so the keystroke targets the Nth terminal regardless of fold
 *  state. */

import type { TerminalId } from "kolu-common/surface";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { DockRowBucket, RankedDockRow } from "./dockRowRanking";

export type DockTreeGroup = {
  kind: "group";
  /** Stable key for fold-state persistence + element keying.
   *  Top-level groups use the repo group name; branch sub-groups use
   *  `"${repo}/${branch}"`. */
  key: string;
  /** Display label rendered in the group header. */
  label: string;
  /** OKLCH color carried from the repo's `repoColor` — used for the
   *  swatch on the header row. */
  color: string;
  /** Render style hint. `0` = top-level repo header, `1` = branch
   *  sub-header. The hierarchy is exactly two levels deep — single-
   *  branch repos collapse to a depth-0 leaf header, multi-branch repos
   *  nest depth-1 sub-headers — so this field doubles as the renderer's
   *  styling key and the tree's actual depth. */
  depth: 0 | 1;
  /** Either child groups (multi-branch repo) or terminal leaves. */
  children: DockTreeNode[];
  /** Total terminal rows underneath, across all depths. Drives the
   *  group-header count badge and is the input for `flattenTerminalIds`. */
  terminalCount: number;
  /** Max `lastActivityAt` across all terminals underneath — the sort key
   *  for sibling groups. */
  recency: number;
};

export type DockTreeTerminal = {
  kind: "terminal";
  id: TerminalId;
  bucket: DockRowBucket;
};

export type DockTreeNode = DockTreeGroup | DockTreeTerminal;

type Entry = {
  row: RankedDockRow;
  group: string;
  label: string;
  color: string;
};

/** Build the repo → branch hierarchy from the ranked-row list and the
 *  display-info accessor. Terminals whose display info hasn't arrived
 *  yet are dropped — `useTerminalMetadata` already gates `terminalIds`
 *  on metadata arrival, so this is defence-in-depth. */
export function buildDockTree(
  ranked: readonly RankedDockRow[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
): DockTreeNode[] {
  const entries: Entry[] = [];
  for (const row of ranked) {
    const info = getDisplayInfo(row.id);
    if (!info) continue;
    entries.push({
      row,
      group: info.key.group,
      label: info.key.label,
      color: info.repoColor,
    });
  }

  // Map preserves first-seen insertion order — `ranked` is already
  // recency-sorted, so iterating it lands the most-recently-active repo
  // first in the map. The final sibling sort below makes the order
  // explicit regardless, but the insertion order keeps ties stable.
  const byGroup = new Map<
    string,
    { color: string; branches: Map<string, Entry[]> }
  >();
  for (const e of entries) {
    let group = byGroup.get(e.group);
    if (!group) {
      group = { color: e.color, branches: new Map() };
      byGroup.set(e.group, group);
    }
    let branchEntries = group.branches.get(e.label);
    if (!branchEntries) {
      branchEntries = [];
      group.branches.set(e.label, branchEntries);
    }
    branchEntries.push(e);
  }

  const topGroups: DockTreeGroup[] = [];
  for (const [groupName, { color, branches }] of byGroup) {
    const branchNames = [...branches.keys()];
    if (branchNames.length === 1) {
      const onlyBranch = branchNames[0] ?? "";
      const branchEntries = branches.get(onlyBranch) ?? [];
      topGroups.push(
        makeLeafGroup(groupName, color, onlyBranch, branchEntries),
      );
      continue;
    }
    const branchGroups: DockTreeGroup[] = branchNames.map((branchName) => {
      const branchEntries = branches.get(branchName) ?? [];
      const terminals = branchEntries.map(toTerminalNode);
      return {
        kind: "group" as const,
        key: `${groupName}/${branchName}`,
        label: branchName,
        color,
        depth: 1 as const,
        children: terminals,
        terminalCount: terminals.length,
        recency: maxRecency(branchEntries),
      };
    });
    branchGroups.sort((a, b) => b.recency - a.recency);
    topGroups.push({
      kind: "group",
      key: groupName,
      label: groupName,
      color,
      depth: 0,
      children: branchGroups,
      terminalCount: branchGroups.reduce((s, g) => s + g.terminalCount, 0),
      // Recency is already computed on each branch child; re-fold over the
      // children rather than re-walking the flat entries list.
      recency: branchGroups.reduce((m, g) => Math.max(m, g.recency), 0),
    });
  }
  topGroups.sort((a, b) => b.recency - a.recency);
  return topGroups;
}

/** Depth-first walk of terminal IDs in tree-render order. Folded groups
 *  do NOT hide their children — `Cmd+1..9` targets the Nth terminal in
 *  render order regardless of fold state, so the hint stays honest. */
export function flattenTerminalIds(
  tree: readonly DockTreeNode[],
): TerminalId[] {
  const out: TerminalId[] = [];
  const walk = (nodes: readonly DockTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "terminal") out.push(node.id);
      else walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** A flat render instruction: either a group header or a terminal slot
 *  paired with its depth-first index in the full tree.
 *
 *  Terminal `index` matches the position in `flattenTerminalIds(tree)` —
 *  i.e. it counts folded siblings too — so `Cmd+1..9` shortcut hints
 *  stay aligned with the same index even when a folded group hides part
 *  of the dock. */
export type DockRenderItem =
  | { kind: "group-header"; group: DockTreeGroup; folded: boolean }
  | { kind: "terminal"; node: DockTreeTerminal; index: number };

/** Flatten the tree into a render-order list, omitting children of
 *  folded groups but preserving their depth-first index slots. Pure —
 *  the fold-state predicate is plugged in. */
export function flattenForRender(
  tree: readonly DockTreeNode[],
  isFolded: (key: string) => boolean,
): DockRenderItem[] {
  const out: DockRenderItem[] = [];
  let terminalIndex = 0;
  const walk = (nodes: readonly DockTreeNode[], skip: boolean) => {
    for (const node of nodes) {
      if (node.kind === "terminal") {
        if (!skip) out.push({ kind: "terminal", node, index: terminalIndex });
        terminalIndex++;
      } else {
        const folded = isFolded(node.key);
        if (!skip) out.push({ kind: "group-header", group: node, folded });
        walk(node.children, skip || folded);
      }
    }
  };
  walk(tree, false);
  return out;
}

function toTerminalNode(e: Entry): DockTreeTerminal {
  return { kind: "terminal", id: e.row.id, bucket: e.row.bucket };
}

function maxRecency(entries: readonly Entry[]): number {
  let max = 0;
  for (const e of entries) if (e.row.ts > max) max = e.row.ts;
  return max;
}

function makeLeafGroup(
  groupName: string,
  color: string,
  onlyBranch: string,
  branchEntries: readonly Entry[],
): DockTreeGroup {
  const terminals = branchEntries.map(toTerminalNode);
  return {
    kind: "group",
    key: groupName,
    label: `${groupName} · ${onlyBranch}`,
    color,
    depth: 0,
    children: terminals,
    terminalCount: terminals.length,
    recency: maxRecency(branchEntries),
  };
}
