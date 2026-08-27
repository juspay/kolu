/** **"Any unique prefix" — how a user names a terminal to padi.**
 *
 *  padi keys its fleet by whole UUIDs, and no human types one. So every kolu
 *  face prints a SHORT id and takes any unambiguous prefix back: `list` shows
 *  `7f3e0a91`, and `attach 7f3e` resolves to the same terminal.
 *
 *  The fold lives HERE, in the contract package, because the rule is a property
 *  of padi's ADDRESSING and not of any face that renders it. It used to live in
 *  `@kolu/padi/render` beside the roster table, which put it behind a manifest
 *  naming `columnify`, `kaval` and `node-pty` — so a client that only wanted to
 *  turn a user's `7f3e` into an id had to install a PTY host, or write the fold
 *  again. Three spellings is what that cost: this one, `kaval-tui/render.ts`,
 *  and one downstream. That package's own README named this as the move to make
 *  "the day one asks".
 *
 *  `@kolu/padi/render` does NOT re-export it — every face imports it from here.
 *  A door kept so import specifiers need not change is backward compatibility,
 *  and `render.ts`'s own header argues that refusal rather than restating it.
 *
 *  `kaval-tui` keeps its copy for now, and that is argued rather than forgotten:
 *  its manifest sits BELOW padi and speaks to kaval directly, so naming
 *  `@kolu/padi-client` there would point the dependency arrow up and drag padi's
 *  whole client contract into a package that has no use for it.
 *
 *  **This file imports NOTHING, and that is the contract, not an accident.** The
 *  consumer that asked for it resolves prefixes in the package its BROWSER
 *  bundles, whose manifest names no kolu package at all. An `import type` from
 *  `@kolu/terminal-vocab` would be free at runtime and still put kolu's schema
 *  graph in that bundle's compile graph — so {@link resolveTerminalId} is
 *  generic over the caller's own id type instead of typed on `TerminalId`. That
 *  costs nothing: `TerminalId` is a checked `Schema.String`, structurally a
 *  string, so padi keeps its branded-looking type in the result and kaval-tui
 *  and a browser keep plain `string`. */

/** The outcome of resolving a user-typed id-or-prefix against the live ids —
 *  pure, so the decision is unit-tested apart from the `fail()`/exit a CLI maps
 *  it to.
 *
 *  `ambiguous` carries the full MATCHES rather than a count, because the caller's
 *  next sentence is "did you mean one of these" and a number cannot say it. */
export type ResolveResult<Id extends string = string> =
  | { kind: "found"; id: Id }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: Id[] };

/** Resolve a user-supplied id-or-prefix to a single full terminal id against the
 *  live `terminals` keys. A full id is a prefix of itself, so a pasted full id
 *  keeps resolving to itself. Matching is case-insensitive — UUIDs are lowercase
 *  hex, but a hand-typed/pasted upper-case prefix should still land. Zero matches
 *  → `none`; more than one → `ambiguous` with the full ids so the caller can ask
 *  for more chars.
 *
 *  Case-folding is kolu's answer and it is a JUDGEMENT, not an oversight — a
 *  consumer whose ids are written by a program rather than typed by a person has
 *  a real argument for byte-exact matching, and olai makes it. There is no knob
 *  here for that: an override is never a feature. A consumer that wants the
 *  other rule states its own, and states why. */
export function resolveTerminalId<Id extends string>(
  query: string,
  ids: Iterable<Id>,
): ResolveResult<Id> {
  // An empty query is a prefix of EVERY id, so with one live terminal it would
  // silently resolve to it — a wrong-terminal footgun when `$id` is accidentally
  // empty. Reject it as a no-match so the caller fails loud instead.
  if (query === "") return { kind: "none" };
  const q = query.toLowerCase();
  // ONE forward pass, over an `Iterable` and not an array, because the client
  // this moved here for holds a live map and would otherwise materialise every
  // key on every keystroke. An array is an Iterable, so kolu's own callers are
  // unchanged. Exact still wins OUTRIGHT — the loop stops on it and the prefix
  // matches collected so far are discarded, which is the same answer a
  // find-then-filter gave.
  const matches: Id[] = [];
  for (const id of ids) {
    const lower = id.toLowerCase();
    if (lower === q) return { kind: "found", id };
    if (lower.startsWith(q)) matches.push(id);
  }
  const [first, ...rest] = matches;
  if (first === undefined) return { kind: "none" };
  if (rest.length > 0) return { kind: "ambiguous", matches };
  return { kind: "found", id: first };
}
