import type { TerminalId } from "kolu-common/surface";
import type { DockOrder } from "../../terminal/dockOrder";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import {
  type NeedsYouEntry,
  needsYouEntries,
  type RankedDockRow,
} from "./dockRowRanking";

export type DockBranchCluster = {
  /** The cluster's branch/intent label — `info.key.label`. */
  label: string;
  rows: readonly RankedDockRow[];
};

export type DockGroup = {
  /** `info.key.group` — git repo name or cwd basename. */
  name: string;
  /** Per-repo OKLCH color (`info.repoColor`). */
  color: string;
  clusters: readonly DockBranchCluster[];
  topRows: readonly RankedDockRow[];
  allTopRows: readonly RankedDockRow[];
  railEntries: readonly DockRailEntry[];
};

export type DockRailEntry =
  | { kind: "top"; row: RankedDockRow }
  | { kind: "split"; row: RankedDockRow["subRows"][number] };

export type DockNeedsYouEntry = NeedsYouEntry & {
  hiddenByFilter: boolean;
};

declare const effectiveDockOrder: unique symbol;

export type EffectiveDockOrder = DockOrder & {
  readonly [effectiveDockOrder]: true;
};

export type DockTree = {
  groups: readonly DockGroup[];
  order: EffectiveDockOrder;

  flatShortcutRows: readonly RankedDockRow[];

  needsYou: readonly DockNeedsYouEntry[];
  parkedCount: number;
  sleepingCount: number;
  hiddenCount: number;
  hasContent: boolean;
};

type RepoBucket = {
  color: string;
  byLabel: Map<string, RankedDockRow[]>;
};

type BucketedRows = {
  byName: Map<string, RepoBucket>;
  parkedCount: number;
  sleepingCount: number;
  hiddenCount: number;
};

type SequencedRepo = {
  name: string;
  color: string;
  clustersByLabel: readonly (readonly [string, RankedDockRow[]])[];
};

type DockProjections = {
  groups: readonly DockGroup[];
  order: EffectiveDockOrder;
  needsYou: readonly DockNeedsYouEntry[];
  flatShortcutRows: readonly RankedDockRow[];
};

type RowFilter = (
  row: RankedDockRow | RankedDockRow["subRows"][number],
) => boolean;

function bucketRows(
  ranked: readonly RankedDockRow[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  filteredOut: RowFilter,
): BucketedRows {
  const byName = new Map<string, RepoBucket>();
  let parkedCount = 0;
  let sleepingCount = 0;
  let hiddenCount = 0;

  for (const row of ranked) {
    const info = getDisplayInfo(row.id);
    if (!info) continue;
    let group = byName.get(info.key.group);
    if (!group) {
      group = {
        color: info.repoColor,
        byLabel: new Map(),
      };
      byName.set(info.key.group, group);
    }
    if (row.bucket === "parked") parkedCount++;
    sleepingCount +=
      (row.bucket === "sleeping" ? 1 : 0) +
      row.subRows.filter((sub) => sub.bucket === "sleeping").length;
    if (filteredOut(row)) hiddenCount += 1 + row.subRows.length;
    else hiddenCount += row.subRows.filter(filteredOut).length;
    const list = group.byLabel.get(info.key.label);
    if (list) list.push(row);
    else group.byLabel.set(info.key.label, [row]);
  }

  return { byName, parkedCount, sleepingCount, hiddenCount };
}

function sequenceBuckets(
  byName: Map<string, RepoBucket>,
  order: DockOrder,
): readonly SequencedRepo[] {
  const repoIdx = new Map<string, number>();
  const labelIdx = new Map<string, Map<string, number>>();
  for (const [i, node] of order.entries()) {
    repoIdx.set(node.repo, i);
    const labels = new Map<string, number>();
    for (const [j, label] of node.labels.entries()) labels.set(label, j);
    labelIdx.set(node.repo, labels);
  }
  const byRank = (ia: number, ib: number) => (ia === ib ? 0 : ia < ib ? -1 : 1);
  return [...byName.entries()]
    .sort(([a], [b]) =>
      byRank(repoIdx.get(a) ?? Infinity, repoIdx.get(b) ?? Infinity),
    )
    .map(([name, g]) => {
      const labelRank = labelIdx.get(name);
      return {
        name,
        color: g.color,
        clustersByLabel: [...g.byLabel.entries()].sort(([a], [b]) =>
          byRank(labelRank?.get(a) ?? Infinity, labelRank?.get(b) ?? Infinity),
        ),
      };
    });
}

function deriveProjections(
  sequencedRepos: readonly SequencedRepo[],
  filteredOut: RowFilter,
): DockProjections {
  const treeOrder: { repo: string; labels: readonly string[] }[] = [];
  const needsYou: DockNeedsYouEntry[] = [];
  const allGroups: DockGroup[] = sequencedRepos.map(
    ({ name, color, clustersByLabel }) => {
      treeOrder.push({ repo: name, labels: clustersByLabel.map(([l]) => l) });
      const clusters = clustersByLabel
        .map(([label, rows]) => ({
          label,
          rows: rows
            .filter((row) => !filteredOut(row))
            .map((row) => ({
              ...row,
              subRows: row.subRows.filter((sub) => !filteredOut(sub)),
            })),
        }))
        .filter(({ rows }) => rows.length > 0);
      const allTopRows = clustersByLabel.flatMap(([, rows]) => rows);
      const topRows = clusters.flatMap((c) => c.rows);
      const railEntries = topRows.flatMap<DockRailEntry>((row) => [
        { kind: "top", row },
        ...row.subRows.map((sub) => ({ kind: "split" as const, row: sub })),
      ]);
      for (const row of allTopRows) {
        const hidden = filteredOut(row);
        for (const entry of needsYouEntries(row)) {
          needsYou.push({ ...entry, hiddenByFilter: hidden });
        }
      }
      return {
        name,
        color,
        clusters,
        allTopRows,
        topRows,
        railEntries,
      };
    },
  );
  const groups = allGroups.filter((g) => g.topRows.length > 0);
  return {
    groups,
    order: treeOrder as DockOrder as EffectiveDockOrder,
    needsYou,
    flatShortcutRows: groups.flatMap((g) => g.topRows),
  };
}

export function buildDockTree(
  ranked: readonly RankedDockRow[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  hideSleeping: boolean,
  order: DockOrder = [],
): DockTree {
  const filteredOut = (
    row: RankedDockRow | RankedDockRow["subRows"][number],
  ): boolean =>
    row.bucket === "parked" || (row.bucket === "sleeping" && hideSleeping);

  const { byName, parkedCount, sleepingCount, hiddenCount } = bucketRows(
    ranked,
    getDisplayInfo,
    filteredOut,
  );
  const projections = deriveProjections(
    sequenceBuckets(byName, order),
    filteredOut,
  );
  return {
    ...projections,
    parkedCount,
    sleepingCount,
    hiddenCount,
    hasContent:
      projections.flatShortcutRows.length > 0 ||
      parkedCount > 0 ||
      sleepingCount > 0,
  };
}

export const arrayMove = <T>(
  list: readonly T[],
  from: number,
  to: number,
): T[] => {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
};

export function spliceVisiblePermutation(
  all: readonly string[],
  permuted: readonly string[],
): readonly string[] {
  const visible = new Set(permuted);
  let i = 0;
  return all.map((l) => (visible.has(l) ? (permuted[i++] as string) : l));
}

export function moveRepo(
  order: EffectiveDockOrder,
  from: string,
  to: string,
): DockOrder {
  const names = order.map((n) => n.repo);
  const i = names.indexOf(from);
  const j = names.indexOf(to);
  return i === -1 || j === -1 ? order.slice() : arrayMove(order, i, j);
}

export function moveCluster(
  order: EffectiveDockOrder,
  repo: string,
  permutedVisible: readonly string[],
): DockOrder {
  const node = order.find((n) => n.repo === repo);
  if (!node) return order.slice();
  const next = order.slice();
  next[order.indexOf(node)] = {
    repo,
    labels: spliceVisiblePermutation(node.labels, permutedVisible),
  };
  return next;
}
