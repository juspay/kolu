/** The palette's two pure policies — kept together because both answer
 *  "given these rows, what does the user see first?", and both are unit-tested
 *  without mounting the palette.
 *
 *  1. **Root ranking + filter** ({@link filterAndRankPaletteItems},
 *     {@link kindRank}, {@link RECENT_TERMINAL_LIMIT}) — the ROOT list's
 *     cross-kind order (terminals → hosts → commands, recency within
 *     terminals, recent-cap on empty root). The dock's AND-token matcher
 *     (`matchesAllTokens` / `tokenize`) is the single filter implementation;
 *     this module only composes it with kind rank.
 *  2. **The default highlight** ({@link defaultSelectionIndex},
 *     {@link CurrentSelection}) — CROSS-LEVEL, not root-only: every switcher
 *     list funnels through it (⌘K root, ⌘⇧K Terminals browse, the ⌘⇧H Hosts
 *     group), which is what keeps "press the chord, press Enter" one gesture
 *     instead of six hand-rolled `setSelectedIndex(0)` calls. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { match } from "ts-pattern";
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

/** Where the user already IS — the canvas host, plus the tile active on it.
 *
 *  ONE host key, not one per kind: the active tile is on the active host by
 *  definition, so "the tile is on gpu-box while the canvas is on local" is a
 *  state this type cannot express. Every switcher skips this row when it picks
 *  its default highlight, which is what makes open-then-Enter a TOGGLE rather
 *  than a no-op; the empty-root Recent band drops it for the same reason. */
export type CurrentSelection = {
  /** Canonical `encodeHostKey` wire form of the canvas host. */
  hostKey: string;
  /** The tile active on that host, or null when the canvas has none. */
  terminalId: string | null;
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
    /** ORDER key for the Recent band — max(your visit, the terminal's own
     *  activity), in milliseconds. Answers "what is WARM", which is the right
     *  question for a list of what to look at, and a background agent's output
     *  is a legitimate answer to it. Higher = more recent. Missing → 0. */
    rankAt?: number | null;
    /** HIGHLIGHT key — when YOU were last on this row, in milliseconds: the
     *  visit trail for a terminal, the switch trail for a host. Never the
     *  server's activity clock.
     *
     *  Separate from {@link rankAt} because ordering and highlighting answer
     *  different questions, and jamming them into one number broke the toggle:
     *  ⌘K → Enter is meant to hop back to where you came FROM, but with the
     *  highlight riding `rankAt` any chattier background agent outranked it and
     *  Enter went somewhere you had never been. Activity has no opinion on
     *  where you have been. Missing → 0, so a list with no trail behind it
     *  (a fresh tab, a plain command list) lands on its first row. */
    visitedAt?: number | null;
    /** Host + id — present on fleet terminal rows for Recent exclusion. */
    hostKey?: string | HostKey;
    terminalId?: string;
  };
};

/** This row's host, canonically encoded. Fleet rows carry `HostKey` objects;
 *  pure tests may pass the encoded string. `undefined` = the row names no host
 *  (a command), which can never BE the current row. */
function rowHostKey(item: IndexableItem): string | undefined {
  const hk = item.row?.hostKey;
  if (hk === undefined) return undefined;
  return typeof hk === "string" ? hk : encodeHostKey(hk);
}

/** Whether this terminal row is the canvas-active tile (host + id). Private,
 *  like {@link isCurrentRow}: the two policies below are the only entry points. */
function isActiveTerminalRow(
  item: IndexableItem,
  current: CurrentSelection | null | undefined,
): boolean {
  if (!current || current.terminalId === null) return false;
  if (itemKind(item) !== "terminal") return false;
  if (item.row?.terminalId !== current.terminalId) return false;
  return rowHostKey(item) === current.hostKey;
}

/** Whether this row is the one the user is already on — the active tile for a
 *  terminal row, the canvas host for a host row. Commands have no "current".
 *  Module-private on purpose: {@link defaultSelectionIndex} is the ONE entry
 *  point, so a second surface can't build a rival policy from the predicate. */
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

/** AND-token corpus — prefer the multi-field `searchText` (workspace dock
 *  corpus / host label+status); fall back to name + description. */
export function searchCorpus(item: IndexableItem): string {
  if (item.row?.searchText !== undefined) return item.row.searchText;
  return `${item.name} ${item.description ?? ""}`;
}

/** The ORDER key — how warm is this row. */
function rankOf(item: IndexableItem): number {
  return item.row?.rankAt ?? item.row?.recencyAt ?? 0;
}

/** The HIGHLIGHT key — when were YOU last here. Deliberately does NOT fall back
 *  to `rankAt`/`recencyAt`: a row with no visit behind it must tie at 0 rather
 *  than borrow an activity stamp and win a toggle it has no claim to. */
function visitedAtOf(item: IndexableItem): number {
  return item.row?.visitedAt ?? 0;
}

/** Filter by AND-token match, then rank for root (or leave registration
 *  order intact when drilled into a group). */
export function filterAndRankPaletteItems<T extends IndexableItem>(
  items: readonly T[],
  opts: {
    query: string;
    atRoot: boolean;
    /** Where the user is. Empty-root Recent omits the active tile so ⌘K →
     *  Enter jumps to the previous visit; search results and Terminals browse
     *  are unaffected (this is read only on the empty-root path). The SAME
     *  value {@link defaultSelectionIndex} takes — one fact, one shape. */
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
    // Empty root: Recent (top N terminals by recency, **minus the active
    // tile**) · Hosts · Commands. Dropping the active row makes the first
    // Recent entry the previous visit — ⌘K then Enter toggles last two.
    const terminals = matched
      .filter((item) => itemKind(item) === "terminal")
      .filter((item) => !isActiveTerminalRow(item, opts.current))
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

/** THE default-highlight rule — the WHOLE rule, one policy behind every
 *  switcher chord, so a "press the chord, press Enter" toggle works the same for
 *  terminals (⌘K) and hosts (⌘⇧H): with a query typed the top match wins
 *  (recency has nothing to say); with no query, **the row of the leading kind
 *  that YOU visited most recently and are not on right now.**
 *
 *  "Visited" is {@link visitedAtOf} — your own trail, never the activity clock
 *  the list is ORDERED by. The two were one number until #2141, which meant a
 *  background agent could take the highlight off the terminal you came from and
 *  send Enter somewhere you had never been.
 *
 *  "Leading kind" is whatever {@link kindRank} put first, so this policy is
 *  defined only on a list {@link filterAndRankPaletteItems} has already
 *  ordered. Confining the search to that kind says one thing: a ⌘K list is a
 *  *terminal* switcher, so the highlight never wanders into a neighbouring
 *  band.
 *
 *  Rows without a rank all tie at 0, so a plain command list keeps landing on
 *  its first row. */
export function defaultSelectionIndex(
  items: readonly IndexableItem[],
  current: CurrentSelection,
  query: string,
): number {
  if (query.trim().length > 0) return 0;
  const lead = items[0];
  if (lead === undefined) return 0;
  const kind = itemKind(lead);
  const best = items.reduce<{ i: number; rank: number } | null>(
    (acc, item, i) => {
      if (itemKind(item) !== kind || isCurrentRow(item, current)) return acc;
      const rank = visitedAtOf(item);
      return acc === null || rank > acc.rank ? { i, rank } : acc;
    },
    null,
  );
  return best?.i ?? 0;
}
