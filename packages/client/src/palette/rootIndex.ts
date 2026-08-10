/** The palette's two pure policies — kept together because both answer
 *  "given these rows, what does the user see first?", and both are unit-tested
 *  without mounting the palette.
 *
 *  1. **Root ranking + filter** ({@link filterAndRankPaletteItems},
 *     {@link kindRank}, {@link RECENT_TERMINAL_LIMIT}) — the ROOT list's
 *     cross-kind order (terminals → hosts → commands, warmth within
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

/** Empty-root Recent band: how many terminals it holds, warmest first. One of
 *  those seats is reserved for the row you last visited — see {@link recentBand},
 *  which SUBSTITUTES rather than grows, so the band is exactly this many rows.
 *  (It read "plus the reserved seat", which sized the band at N + 1.) */
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
    /** The terminal's OWN activity clock — server/dock activity, painted as the
     *  row's "3m ago". Absent on rows that have no such clock. */
    recencyAt?: number | null;
    /** When YOU were last on this row, in milliseconds: the visit trail for a
     *  terminal, the switch trail for a host. Never the server's activity
     *  clock. Missing → 0, so a list with no trail behind it (a fresh tab, a
     *  plain command list) lands on its first row.
     *
     *  These two are the row's only stored clocks, and they are GROUNDED —
     *  each is a fact somebody measured. The two questions the palette asks
     *  are both derived from them, at the sites that ask:
     *  {@link rankOf} (warmth → ORDER) and {@link rowVisitedAt} (your trail →
     *  HIGHLIGHT). A third stored `rankAt` used to hold the warmth derivation,
     *  which meant a row could carry a rank contradicting its own inputs — and
     *  meant "fold the two questions back into one number" was a thing an edit
     *  could do. With no such field there is nothing to fold.
     *
     *  A plain `number`, deliberately unlike its `recencyAt` neighbour: both
     *  producers (`visitedAtOf`, `switchedAtOf`) return `0` for "never here",
     *  so `null` was a third spelling of a state no producer emits and no
     *  consumer distinguishes. `recencyAt` genuinely needs its `null` (never
     *  active, rendered as the empty string); giving the two clocks the same
     *  shape invited exactly the conflation this change undid. `undefined`
     *  stays, and means the row KIND has no trail at all — a command row. */
    visitedAt?: number;
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

/** The ORDER key — how WARM is this row: the later of your last visit and its
 *  own activity. Output is a legitimate answer to "what should I look at", so
 *  the activity clock belongs here. Derived, never stored. */
function rankOf(item: IndexableItem): number {
  return Math.max(item.row?.visitedAt ?? 0, item.row?.recencyAt ?? 0);
}

/** The HIGHLIGHT key — when were YOU last here. Deliberately does NOT consider
 *  `recencyAt`: a row with no visit behind it must tie at 0 rather than borrow
 *  an activity stamp and win a toggle it has no claim to.
 *
 *  Named for the field rather than reusing `visitRecency`'s `visitedAtOf` name:
 *  that one is the trail LOOKUP (the producer), this is the row ACCESSOR (the
 *  consumer), and they sit at the two ends of the same field. */
function rowVisitedAt(item: IndexableItem): number {
  return item.row?.visitedAt ?? 0;
}

/** The row a no-query Enter should land on among `items` — the one YOU visited
 *  most recently, never the one you are already on.
 *
 *  **The ONE answer**, and that is the whole point: {@link recentBand} reserves a
 *  seat for it and {@link defaultSelectionIndex} points the highlight at it, and
 *  the reserved seat's guarantee is only worth anything while those two agree
 *  about which row it is. They used to be two `reduce`s in this one file with
 *  two different guard sets — the band's excluded nothing and leaned on its
 *  caller having filtered the active tile out upstream, the highlight's excluded
 *  the current row and every non-leading kind. Give either one a new condition
 *  and the band reserves a seat the highlight will not land on: the exact defect
 *  the seat exists to prevent, one edit away. Now it cannot be spelled.
 *
 *  The `> 0` guard says "no visit behind it, no claim on the toggle" out loud,
 *  rather than leaving it to emerge from a `>` comparison over zeroes. */
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

/** The empty-root **Recent** band: the warmest {@link RECENT_TERMINAL_LIMIT}
 *  candidates, in warmth order — **with the row you last visited guaranteed a
 *  seat.**
 *
 *  That guarantee lives HERE, not in {@link defaultSelectionIndex}, because
 *  this is the layer that knows what will be in the list. The highlight rule
 *  can only choose among rows it is handed, so a cap applied on a different key
 *  can silently defeat it: leave terminal A, let three background agents print
 *  after you, and all three outrank A on warmth. A is sliced out, every
 *  survivor has `visitedAt: 0`, they tie, and Enter lands on the chattiest
 *  stranger — #2141's exact defect, moved one layer down and just as invisible.
 *
 *  So the band reserves one seat for the toggle target and gives it to the
 *  coldest kept row's slot. Display order stays pure warmth: the reserved row
 *  takes its honest position, which is usually last — the highlight is what
 *  points at it, not its rank. A candidate set with no visits behind it (a
 *  fresh tab) reserves nothing and the band is the plain top N. */
function recentBand<T extends IndexableItem>(
  candidates: readonly T[],
  current?: CurrentSelection | null,
): T[] {
  const byWarmth = [...candidates].sort((a, b) => rankOf(b) - rankOf(a));
  if (byWarmth.length <= RECENT_TERMINAL_LIMIT) return byWarmth;
  const kept = new Set(byWarmth.slice(0, RECENT_TERMINAL_LIMIT));
  // The SAME argmax the highlight uses — see {@link toggleTarget}. The seat and
  // the highlight are now one answer read twice, not two reduces that matched.
  const target = toggleTarget(candidates, current);
  if (target !== undefined && !kept.has(target)) {
    // Evict the coldest row we were keeping — never the warmest, and never a
    // row that is itself the target.
    const coldest = byWarmth[RECENT_TERMINAL_LIMIT - 1];
    if (coldest !== undefined) kept.delete(coldest);
    kept.add(target);
  }
  return byWarmth.filter((item) => kept.has(item));
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
    // Empty root: Recent (top N terminals by warmth, **minus the active
    // tile**) · Hosts · Commands. Dropping the active row is what makes ⌘K →
    // Enter a toggle rather than a no-op.
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

  // Queried root: kind rank, warmth within terminals, section among commands.
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
 *  "Visited" is {@link rowVisitedAt} — your own trail, never the activity clock
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
  const leading = items.filter((item) => itemKind(item) === kind);
  const target = toggleTarget(leading, current);
  if (target !== undefined) return items.indexOf(target);
  // Nothing in the leading band has a visit behind it — everything ties at 0.
  // Land on the first row that is not the one you are already on, so the chord
  // is still a toggle rather than a no-op.
  const firstOther = leading.find((item) => !isCurrentRow(item, current));
  return firstOther === undefined ? 0 : items.indexOf(firstOther);
}
