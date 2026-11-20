import { ancestorDirectoryPaths } from "@kolu/solid-pierre/paths";

type FileTreeSearchProjection = {
  projectedPaths: string[];
  expandedAncestors: string[];
};

declare const nfcSearchKey: unique symbol;
type SearchKey = string & { readonly [nfcSearchKey]: true };

function toNfcSearchKey(value: string): SearchKey {
  const trimmed = value.trim();
  return (trimmed.includes("\\") ? trimmed.replaceAll("\\", "/") : trimmed)
    .normalize("NFC")
    .toLowerCase() as SearchKey;
}

function pathContainsTokensInOrder(
  path: string,
  tokens: readonly SearchKey[],
): boolean {
  const normalizedPath = toNfcSearchKey(path);
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
  const tokens = toNfcSearchKey(query)
    .split(/\s+/)
    .filter(Boolean) as SearchKey[];
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
