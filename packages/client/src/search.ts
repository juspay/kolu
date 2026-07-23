/** Shared query helpers — the one AND-token matcher for the command
 *  palette root index, the dock workspace grid, and any other multi-field
 *  search surface. Lowercase the query, split on whitespace, then require
 *  every token to appear as a substring of the candidate text. "kolu auth"
 *  matches "auth-fix · kolu · …" regardless of token order. */

export function tokenize(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesAllTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}
