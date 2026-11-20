export function tokenize(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function matchesAllTokens(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const lower = text.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}
