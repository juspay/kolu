/** Shared query helpers — used by the command palette filter and the
 *  workspace-entry search. One implementation so both surfaces have
 *  identical multi-token semantics: lowercase the query, split on
 *  whitespace, then require every token to appear as a substring of
 *  the candidate text. "kolu auth" matches "auth-fix · kolu · …"
 *  regardless of which order the tokens appear in the row. */

export function tokenize(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesAllTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}
