/** Host-side filter projection for the Code-tab file tree.
 *
 *  Kolu does **all** of the filtering — Pierre never sees the query.
 *  Pierre's `hide-non-matches` mode forcibly re-expands every match
 *  ancestor on each store event (`FileTreeController#refreshActiveSearchState`),
 *  which makes a user-initiated folder collapse impossible to keep
 *  while a query is live. By projecting the path set on Kolu's side and
 *  driving Pierre purely through `paths` + a list of ancestors to
 *  expand, the controller stays out of the collapse path entirely —
 *  the user's collapse sticks, and the filter survives the click.
 *
 *  `projectedPaths` is the visible inventory. `expandedAncestors` is
 *  the directories the wrapper should ensure are open so matches don't
 *  hide behind a collapsed parent on first paint. */

type FileTreeSearchProjection = {
  projectedPaths: string[];
  expandedAncestors: string[];
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

/** Pierre uses `getAncestorDirectoryPaths` internally to drive
 *  expansion in `hide-non-matches` mode. Mirror that exact shape so
 *  the wrapper's expansion request reaches every dir Pierre infers
 *  from the projected paths. */
function ancestorDirectoryPaths(path: string): string[] {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalized.length === 0) return [];
  const segments = normalized.split("/");
  const out: string[] = [];
  for (let i = 1; i < segments.length; i += 1) {
    out.push(`${segments.slice(0, i).join("/")}/`);
  }
  return out;
}

export function projectFileTreeSearch(
  paths: string[],
  query: string,
): FileTreeSearchProjection {
  const tokens = normalizePathSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { projectedPaths: paths, expandedAncestors: [] };
  }
  const matches = paths.filter((path) =>
    pathContainsTokensInOrder(path, tokens),
  );
  const ancestors = new Set<string>();
  for (const match of matches) {
    for (const ancestor of ancestorDirectoryPaths(match)) {
      ancestors.add(ancestor);
    }
  }
  return { projectedPaths: matches, expandedAncestors: [...ancestors] };
}
