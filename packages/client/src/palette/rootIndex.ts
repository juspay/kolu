/** Root-index ranking + filter for the unified command palette.
 *
 *  Pure helpers so the cross-kind order (terminals → hosts → commands,
 *  recency within terminals, recent-cap on empty root) is unit-tested
 *  without mounting the palette. The dock's AND-token matcher
 *  (`matchesAllTokens` / `tokenize`) is the single filter implementation —
 *  this module only composes it with kind rank. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { matchesAllTokens, tokenize } from "../search";

export type ResultKind = "terminal" | "host" | "command";

/** Rank so terminals float above hosts above commands in a mixed root search. */
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

/** Empty-root Recent band: top N terminals by recency. */
export const RECENT_TERMINAL_LIMIT = 3;

/** Identity of the canvas-active terminal — used only to drop that row from
 *  empty-root Recent so ⌘K → Enter toggles the previous visit. */
export type ActiveTerminalRef = {
  /** Canonical `encodeHostKey` wire form. */
  hostKey: string;
  terminalId: string;
};

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
    /** Display age (activity clock). Not used for root sort when rankAt set. */
    recencyAt?: number | null;
    /** Sort key — max(visit, activity). Higher = more recent. Missing → 0. */
    rankAt?: number | null;
    /** Host + id — present on fleet terminal rows for Recent exclusion. */
    hostKey?: string | HostKey;
    terminalId?: string;
  };
};

/** Whether this terminal row is the canvas-active tile (host + id). */
export function isActiveTerminalRow(
  item: IndexableItem,
  active: ActiveTerminalRef | null | undefined,
): boolean {
  if (!active) return false;
  if (itemKind(item) !== "terminal") return false;
  const id = item.row?.terminalId;
  if (id === undefined || id !== active.terminalId) return false;
  const hk = item.row?.hostKey;
  if (hk === undefined) return false;
  // Fleet rows pass HostKey objects; pure tests may pass the encoded string.
  const encoded = typeof hk === "string" ? hk : encodeHostKey(hk);
  return encoded === active.hostKey;
}

export function itemKind(item: IndexableItem): ResultKind {
  return item.row?.kind ?? "command";
}

/** AND-token corpus — prefer the multi-field `searchText` (workspace dock
 *  corpus / host label+status); fall back to name + description. */
export function searchCorpus(item: IndexableItem): string {
  if (item.row?.searchText !== undefined) return item.row.searchText;
  return `${item.name} ${item.description ?? ""}`;
}

function rankOf(item: IndexableItem): number {
  return item.row?.rankAt ?? item.row?.recencyAt ?? 0;
}

/** Filter by AND-token match, then rank for root (or leave registration
 *  order intact when drilled into a group). */
export function filterAndRankPaletteItems<T extends IndexableItem>(
  items: readonly T[],
  opts: {
    query: string;
    atRoot: boolean;
    /** Empty-root Recent omits this terminal so ⌘K → Enter jumps to the
     *  previous visit. Search results and Terminals browse are unaffected. */
    excludeFromRecent?: ActiveTerminalRef | null;
  },
): T[] {
  const tokens = tokenize(opts.query);
  const matched =
    tokens.length === 0
      ? [...items]
      : items.filter((item) => matchesAllTokens(searchCorpus(item), tokens));

  if (!opts.atRoot) return matched;

  if (tokens.length === 0) {
    // Empty root: Recent (top N terminals by recency, **minus the active
    // tile**) · Hosts · Commands. Dropping the active row makes the first
    // Recent entry the previous visit — ⌘K then Enter toggles last two.
    const terminals = matched
      .filter((item) => itemKind(item) === "terminal")
      .filter((item) => !isActiveTerminalRow(item, opts.excludeFromRecent))
      .sort((a, b) => rankOf(b) - rankOf(a))
      .slice(0, RECENT_TERMINAL_LIMIT);
    const hosts = matched.filter((item) => itemKind(item) === "host");
    const commands = matched
      .filter((item) => itemKind(item) === "command")
      .sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0));
    return [...terminals, ...hosts, ...commands];
  }

  // Queried root: kind rank, recency within terminals, section among commands.
  // Active terminal stays visible — you may legitimately search for it.
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
