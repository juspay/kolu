/** HOW KOLU READS AN ADDRESS — the plumbing under every `#/…` grammar, and
 *  nothing about any of them.
 *
 *  Two grammars use it and they are deliberately separate: `deepLink.ts`
 *  routes COMMANDS onto the one workspace view, and `conductor/reader/
 *  useReader.ts` names the document a pop-out window IS. What they share is
 *  not the vocabulary but the mechanics — strip the `#`, split the query off,
 *  split the path, drop exactly one leading empty segment, decode each — and
 *  that was written out twice, which is how two readers of one address come
 *  to disagree about a trailing slash.
 *
 *  REJECT WHOLE. An empty segment (a repeated or trailing slash) and a
 *  malformed %-escape are not addresses kolu ever produced, so they are
 *  refused here rather than silently collapsed; each caller says what it does
 *  about a refusal, because that part IS the grammar's. */

/** What a hash reads as: a path (possibly with a query behind it), no route
 *  at all, or something malformed with a sentence saying which. */
export type HashRead =
  | {
      readonly kind: "path";
      readonly segments: ReadonlyArray<string>;
      readonly query: string;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "bad"; readonly reason: string };

export function hashSegments(hash: string): HashRead {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const at = raw.indexOf("?");
  const path = at === -1 ? raw : raw.slice(0, at);
  const query = at === -1 ? "" : raw.slice(at + 1);

  // An empty or bare-slash PATH carries no route — checked AFTER the query is
  // split off, so a root hash with an incidental query (`#/?utm=x`, a bookmark
  // saved with a trailing `?`) is `empty`, not a false "malformed" verdict.
  if (path === "" || path === "/") return { kind: "empty" };

  const parts = path.split("/");
  if (parts[0] === "") parts.shift();
  if (parts.length === 0) return { kind: "empty" };
  if (parts.some((one) => one === ""))
    return {
      kind: "bad",
      reason: "empty path segment (a repeated or trailing slash)",
    };
  try {
    return {
      kind: "path",
      segments: parts.map((one) => decodeURIComponent(one)),
      query,
    };
  } catch {
    return { kind: "bad", reason: "malformed URL-encoding in the path" };
  }
}
