import {
  activeArm,
  sleepingArm,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import {
  type DockPaintBucket,
  type DockRowBucket,
  dockOverlayBucket,
  paintDockRow,
  type UnparkedPaintBucket as SubDockPaintBucket,
} from "@kolu/solid-dockrow/rowValues";
import {
  type AttentionClass,
  agentUrgency,
  type TerminalId,
} from "kolu-common/surface";
import { match, P } from "ts-pattern";
import type { PaneNode } from "../../terminal/terminalTree";

export type { DockRowBucket };

type DockOrderBucket = Exclude<DockRowBucket, "linger">;

type SubDockOrderBucket = Exclude<DockOrderBucket, "parked">;

function classifyDockRow(
  meta: TerminalMetadata,
  parked: false,
): SubDockOrderBucket;
function classifyDockRow(
  meta: TerminalMetadata,
  parked: boolean,
): DockOrderBucket;
function classifyDockRow(
  meta: TerminalMetadata,
  parked: boolean,
): DockOrderBucket {
  const overlay = dockOverlayBucket(meta, parked);
  if (overlay) return overlay;
  const agent = activeArm(meta)?.agent;
  switch (agentUrgency(agent)) {
    case "need":
      return "awaiting";
    case "work":
      return "working";
    case "idle": {
      const everActive = agent != null || meta.lastActivityAt !== null;
      return everActive ? "idle" : "none";
    }
  }
}

type DockRowCore = {
  id: TerminalId;
  bucket: DockOrderBucket;
  asking: boolean;
  pip: DockPaintBucket;
  ts: number | null;
};

type SubDockRowCore = Omit<DockRowCore, "bucket" | "pip"> & {
  pip: SubDockPaintBucket;
  parentId: TerminalId;
  depth: number;
};

type ShellSubDockOrderBucket = Extract<
  SubDockOrderBucket,
  "idle" | "none" | "sleeping"
>;
type AgentSubDockOrderBucket = Exclude<SubDockOrderBucket, "none" | "sleeping">;

type SubDockRow =
  | (SubDockRowCore & {
      kind: "shell";
      bucket: ShellSubDockOrderBucket;
    })
  | (SubDockRowCore & {
      kind: "agent";
      bucket: AgentSubDockOrderBucket;
    });

export type RankedDockRow = DockRowCore & {
  subRows: readonly SubDockRow[];
};

export function rowRecencyAt(meta: TerminalMetadata): number | null {
  return sleepingArm(meta)?.sleptAt ?? meta.lastActivityAt;
}

export function tsRank(ts: number | null): number {
  return ts ?? Number.NEGATIVE_INFINITY;
}

export function rankDockRows(
  ids: readonly TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  isStale: (lastActivityAt: number | null) => boolean,
  classOf: (id: TerminalId) => AttentionClass,
  getPaneTree: (tileId: TerminalId) => readonly PaneNode[],
): RankedDockRow[] {
  const rows: RankedDockRow[] = [];
  for (const id of ids) {
    const meta = getMeta(id);
    if (!meta) continue;
    const subRows = rankSubTree(getPaneTree(id), getMeta, classOf, id);
    let recencyAt = rowRecencyAt(meta);
    for (const sub of subRows) {
      if (tsRank(sub.ts) > tsRank(recencyAt)) recencyAt = sub.ts;
    }
    const parked = isStale(recencyAt);
    const klass = classOf(id);
    rows.push({
      id,
      bucket: classifyDockRow(meta, parked),
      pip: paintDockRow(meta, klass, parked),
      asking: klass === "asking",
      ts: recencyAt,
      subRows,
    });
  }
  return rows;
}

export type NeedsYouRow = RankedDockRow | RankedDockRow["subRows"][number];

export type NeedsYouEntry = {
  tile: RankedDockRow;
  blocked: NeedsYouRow;
};

export function needsYouEntries(row: RankedDockRow): NeedsYouEntry[] {
  const blocked: NeedsYouRow[] = [];
  if (row.asking) blocked.push(row);
  for (const sub of row.subRows) if (sub.asking) blocked.push(sub);
  return blocked.map((b) => ({ tile: row, blocked: b }));
}

function rankSubTree(
  nodes: readonly PaneNode[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  classOf: (id: TerminalId) => AttentionClass,
  parentId: TerminalId,
  depth = 1,
): SubDockRow[] {
  return nodes.flatMap((node) => {
    const row = rankSubRow(node.id, parentId, depth, getMeta, classOf);
    if (!row) return [];
    return [
      row,
      ...rankSubTree(node.children, getMeta, classOf, node.id, depth + 1),
    ];
  });
}

function rankSubRow(
  id: TerminalId,
  parentId: TerminalId,
  depth: number,
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  classOf: (id: TerminalId) => AttentionClass,
): SubDockRow | undefined {
  const meta = getMeta(id);
  if (!meta) return undefined;
  const bucket = classifyDockRow(meta, false);
  const klass = classOf(id);
  const core = {
    id,
    parentId,
    depth,
    ts: rowRecencyAt(meta),
    pip: paintDockRow(meta, klass, false),
    asking: klass === "asking",
  };
  const agent = activeArm(meta)?.agent;
  if (!agent) {
    return match(bucket)
      .with(P.union("idle", "none", "sleeping"), (shellBucket) => ({
        ...core,
        kind: "shell" as const,
        bucket: shellBucket,
      }))
      .with(P.union("awaiting", "working"), (invalidBucket) => {
        throw new Error(
          `rankDockRows: agentless split ${id} classified as ${invalidBucket}`,
        );
      })
      .exhaustive();
  }
  return match(bucket)
    .with(P.union("awaiting", "working", "idle"), (agentBucket) => ({
      ...core,
      kind: "agent" as const,
      bucket: agentBucket,
    }))
    .with(P.union("none", "sleeping"), (invalidBucket) => {
      throw new Error(
        `rankDockRows: agent split ${id} classified as ${invalidBucket}`,
      );
    })
    .exhaustive();
}
