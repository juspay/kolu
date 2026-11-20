import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { match } from "ts-pattern";
import { matchesAllTokens, tokenize } from "../search";

export type ResultKind = "terminal" | "host" | "command";

export function kindRank(kind: ResultKind): number {
  switch (kind) {
    case "terminal":
      return 0;
    case "host":
      return 1;
    case "command":
      return 2;
  }
}

export const RECENT_TERMINAL_LIMIT = 3;

export type CurrentSelection = {
  hostKey: string;
  terminalId: string | null;
};

export type IndexableItem = {
  name: string;
  description?: string;
  sectionOrder?: number;
  row?: {
    kind: ResultKind;
    searchText?: string;
    recencyAt?: number | null;
    visitedAt?: number;
    hostKey?: string | HostKey;
    terminalId?: string;
  };
};

function rowHostKey(item: IndexableItem): string | undefined {
  const hk = item.row?.hostKey;
  if (hk === undefined) return undefined;
  return typeof hk === "string" ? hk : encodeHostKey(hk);
}

function isActiveTerminalRow(
  item: IndexableItem,
  current: CurrentSelection | null | undefined,
): boolean {
  if (!current || current.terminalId === null) return false;
  if (itemKind(item) !== "terminal") return false;
  if (item.row?.terminalId !== current.terminalId) return false;
  return rowHostKey(item) === current.hostKey;
}

function isCurrentRow(item: IndexableItem, current: CurrentSelection): boolean {
  return match(itemKind(item))
    .with("terminal", () => isActiveTerminalRow(item, current))
    .with("host", () => rowHostKey(item) === current.hostKey)
    .with("command", () => false)
    .exhaustive();
}

export function itemKind(item: IndexableItem): ResultKind {
  return item.row?.kind ?? "command";
}

export function searchCorpus(item: IndexableItem): string {
  if (item.row?.searchText !== undefined) return item.row.searchText;
  return `${item.name} ${item.description ?? ""}`;
}

function rankOf(item: IndexableItem): number {
  return Math.max(item.row?.visitedAt ?? 0, item.row?.recencyAt ?? 0);
}

function rowVisitedAt(item: IndexableItem): number {
  return item.row?.visitedAt ?? 0;
}

function toggleTarget<T extends IndexableItem>(
  items: readonly T[],
  current?: CurrentSelection | null,
): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (rowVisitedAt(item) <= 0) continue;
    if (current && isCurrentRow(item, current)) continue;
    if (best === undefined || rowVisitedAt(item) > rowVisitedAt(best)) {
      best = item;
    }
  }
  return best;
}

function recentBand<T extends IndexableItem>(
  candidates: readonly T[],
  current?: CurrentSelection | null,
): T[] {
  const byWarmth = [...candidates].sort((a, b) => rankOf(b) - rankOf(a));
  if (byWarmth.length <= RECENT_TERMINAL_LIMIT) return byWarmth;
  const target = toggleTarget(candidates, current);
  if (target === undefined) return byWarmth.slice(0, RECENT_TERMINAL_LIMIT);
  const at = byWarmth.indexOf(target);
  if (at < RECENT_TERMINAL_LIMIT)
    return byWarmth.slice(0, RECENT_TERMINAL_LIMIT);
  return [...byWarmth.slice(0, RECENT_TERMINAL_LIMIT - 1), target];
}

export function filterAndRankPaletteItems<T extends IndexableItem>(
  items: readonly T[],
  opts: {
    query: string;
    atRoot: boolean;
    current?: CurrentSelection | null;
  },
): T[] {
  const tokens = tokenize(opts.query);
  const matched =
    tokens.length === 0
      ? [...items]
      : items.filter((item) => matchesAllTokens(searchCorpus(item), tokens));

  if (!opts.atRoot) return matched;

  if (tokens.length === 0) {
    const terminals = recentBand(
      matched
        .filter((item) => itemKind(item) === "terminal")
        .filter((item) => !isActiveTerminalRow(item, opts.current)),
      opts.current,
    );
    const hosts = matched.filter((item) => itemKind(item) === "host");
    const commands = matched
      .filter((item) => itemKind(item) === "command")
      .sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0));
    return [...terminals, ...hosts, ...commands];
  }

  return matched.sort((a, b) => {
    const kr = kindRank(itemKind(a)) - kindRank(itemKind(b));
    if (kr !== 0) return kr;
    if (itemKind(a) === "terminal") {
      const delta = rankOf(b) - rankOf(a);
      if (delta !== 0) return delta;
    }
    return (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0);
  });
}

export function defaultSelectionIndex(
  items: readonly IndexableItem[],
  current: CurrentSelection,
  query: string,
): number {
  if (query.trim().length > 0) return 0;
  const lead = items[0];
  if (lead === undefined) return 0;
  const kind = itemKind(lead);
  const leading = items.filter((item) => itemKind(item) === kind);
  const target = toggleTarget(leading, current);
  if (target !== undefined) return items.indexOf(target);
  const firstOther = leading.find((item) => !isCurrentRow(item, current));
  return firstOther === undefined ? 0 : items.indexOf(firstOther);
}
