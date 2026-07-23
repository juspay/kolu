/** Root-index ranking + filter for the unified command palette.
 *
 *  Pure helpers so the cross-kind order (workspaces → hosts → commands,
 *  recency within workspaces, recent-cap on empty root) is unit-tested
 *  without mounting the palette. The dock's AND-token matcher
 *  (`matchesAllTokens` / `tokenize`) is the single filter implementation —
 *  this module only composes it with kind rank. */

import { matchesAllTokens, tokenize } from "../search";

export type ResultKind = "workspace" | "host" | "command";

/** Rank so workspaces float above hosts above commands in a mixed root search. */
export function kindRank(kind: ResultKind): number {
  switch (kind) {
    case "workspace":
      return 0;
    case "host":
      return 1;
    case "command":
      return 2;
  }
}

export const RECENT_WORKSPACE_LIMIT = 3;

/** Fields the root index needs off a palette row. Intentionally minimal so
 *  tests construct plain objects without the full PaletteAction shape. */
export type IndexableItem = {
  name: string;
  description?: string;
  /** Stable registration order among commands (section-sorted upstream). */
  sectionOrder?: number;
  row?: {
    kind: ResultKind;
    searchText?: string;
    /** Higher = more recent. Missing treated as 0. */
    recencyAt?: number | null;
  };
};

export function itemKind(item: IndexableItem): ResultKind {
  return item.row?.kind ?? "command";
}

/** AND-token corpus — prefer the multi-field `searchText` (workspace dock
 *  corpus / host label+status); fall back to name + description. */
export function searchCorpus(item: IndexableItem): string {
  if (item.row?.searchText !== undefined) return item.row.searchText;
  return `${item.name} ${item.description ?? ""}`;
}

function recencyOf(item: IndexableItem): number {
  return item.row?.recencyAt ?? 0;
}

/** Filter by AND-token match, then rank for root (or leave registration
 *  order intact when drilled into a group). */
export function filterAndRankPaletteItems<T extends IndexableItem>(
  items: readonly T[],
  opts: { query: string; atRoot: boolean },
): T[] {
  const tokens = tokenize(opts.query);
  const matched =
    tokens.length === 0
      ? [...items]
      : items.filter((item) => matchesAllTokens(searchCorpus(item), tokens));

  if (!opts.atRoot) return matched;

  if (tokens.length === 0) {
    // Empty root: Recent (top N workspaces by recency) · Hosts · Commands.
    const workspaces = matched
      .filter((item) => itemKind(item) === "workspace")
      .sort((a, b) => recencyOf(b) - recencyOf(a))
      .slice(0, RECENT_WORKSPACE_LIMIT);
    const hosts = matched.filter((item) => itemKind(item) === "host");
    const commands = matched
      .filter((item) => itemKind(item) === "command")
      .sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0));
    return [...workspaces, ...hosts, ...commands];
  }

  // Queried root: kind rank, recency within workspaces, section among commands.
  return matched.sort((a, b) => {
    const kr = kindRank(itemKind(a)) - kindRank(itemKind(b));
    if (kr !== 0) return kr;
    if (itemKind(a) === "workspace") {
      const delta = recencyOf(b) - recencyOf(a);
      if (delta !== 0) return delta;
    }
    return (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0);
  });
}
