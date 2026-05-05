/** Search projection for Pierre's current substring-only FileTree API.
 *
 *  `projectedPaths` is the optional Kolu-side visibility filter; for native
 *  single-token searches it is the original path inventory by reference.
 *  `pierreSearchQuery` is the residual substring Pierre should own for
 *  expansion/focus after Kolu has handled multi-token path matching. */
type FileTreeSearchProjection = {
  projectedPaths: string[];
  pierreSearchQuery: string | null;
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
  paths: string[],
  query: string,
): FileTreeSearchProjection {
  const tokens = normalizePathSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return { projectedPaths: paths, pierreSearchQuery: query };
  }

  return {
    projectedPaths: paths.filter((path) =>
      pathContainsTokensInOrder(path, tokens),
    ),
    pierreSearchQuery: tokens.at(-1) ?? null,
  };
}
