/** Search projection for Pierre's current substring-only FileTree API.
 *
 *  `projectedPaths` is Kolu's visibility filter. Keeping Code-tab search as
 *  a path-list projection leaves Pierre's normal folder collapse semantics
 *  intact; Pierre's internal search expands matching ancestors after each
 *  row click, which makes filtered folders impossible to collapse. */
type FileTreeSearchProjection = {
  projectedPaths: string[];
  expandedPathsOnReset: string[] | null;
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

function getAncestorDirectoryPaths(path: string): string[] {
  const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalizedPath.length === 0) return [];

  const segments = normalizedPath.split("/");
  return segments
    .slice(0, -1)
    .map((_, index) => `${segments.slice(0, index + 1).join("/")}/`);
}

function getExpandedPathsForMatches(paths: readonly string[]): string[] {
  const expandedPaths = new Set<string>();
  for (const path of paths) {
    for (const ancestorPath of getAncestorDirectoryPaths(path)) {
      expandedPaths.add(ancestorPath);
    }
  }
  return [...expandedPaths];
}

export function projectFileTreeSearch(
  paths: string[],
  query: string,
): FileTreeSearchProjection {
  const tokens = normalizePathSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return {
      projectedPaths: paths,
      expandedPathsOnReset: null,
      pierreSearchQuery: null,
    };
  }

  const projectedPaths = paths.filter((path) =>
    pathContainsTokensInOrder(path, tokens),
  );

  return {
    projectedPaths,
    expandedPathsOnReset: getExpandedPathsForMatches(projectedPaths),
    pierreSearchQuery: null,
  };
}
