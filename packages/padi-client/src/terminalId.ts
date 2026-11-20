/** The outcome of resolving a user-typed id-or-prefix against the live ids.
 *
 *  `ambiguous` carries the full MATCHES rather than a count, so the caller can
 *  ask "did you mean one of these". */
export type ResolveResult<Id extends string = string> =
  | { kind: "found"; id: Id }
  | { kind: "none" }
  | { kind: "ambiguous"; matches: Id[] };

/** Resolve a user-supplied id-or-prefix to a single full terminal id against the
 *  live `terminals` keys. A full id is a prefix of itself, so a pasted full id
 *  keeps resolving to itself. Matching is case-insensitive. Zero matches
 *  → `none`; more than one → `ambiguous` with the full ids so the caller can ask
 *  for more chars.
 *
 *  Generic over the caller's own id type, so a consumer keeps whatever string
 *  type it already has. */
export function resolveTerminalId<Id extends string>(
  query: string,
  ids: Iterable<Id>,
): ResolveResult<Id> {
  if (query === "") return { kind: "none" };
  const q = query.toLowerCase();
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
