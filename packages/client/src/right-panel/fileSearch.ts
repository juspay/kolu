export type FileTreeSearchProjection = {
  paths: string[];
  treeSearchQuery: string | null;
};

function normalizePathSearchText(value: string): string {
  const trimmed = value.trim();
  return (
    trimmed.includes("\\") ? trimmed.replaceAll("\\", "/") : trimmed
  ).toLowerCase();
}

function pathContainsTokensInOrder(
  path: string,
  tokens: readonly string[],
): boolean {
  const normalizedPath = normalizePathSearchText(path);
  let offset = 0;
  for (const token of tokens) {
    const index = normalizedPath.indexOf(token, offset);
    if (index < 0) return false;
    offset = index + token.length;
  }
  return true;
}

export function projectFileTreeSearch(
  paths: readonly string[],
  query: string,
): FileTreeSearchProjection {
  const tokens = normalizePathSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return { paths: [...paths], treeSearchQuery: query };
  }

  return {
    paths: paths.filter((path) => pathContainsTokensInOrder(path, tokens)),
    treeSearchQuery: tokens.at(-1) ?? null,
  };
}
