/** Replace home directory prefix with ~ for compact display. */
export function shortenCwd(cwd: string): string {
  return cwd.replace(/^\/(home\/[^/]+|root)(\/|$)/, "~$2");
}

/** Last segment of a path, with ~ for home. Used for compact sidebar labels. */
export function cwdBasename(cwd: string): string {
  const short = shortenCwd(cwd);
  return short.split("/").pop() || "~";
}

import type { TerminalInfo } from "kolu-common";

/** Assign OKLCH colors via golden-angle hue spacing.
 *  All keys share one sequence so no two get the same color. */
function assignColors(keys: Iterable<string>): Map<string, string> {
  return new Map(
    [...new Set(keys)]
      .sort()
      .map((key, i) => [key, `oklch(0.75 0.14 ${(i * 137.508) % 360})`]),
  );
}

/** Build unified repo + branch color maps from terminal list.
 *  All repo names and branch names are fed into a single color sequence
 *  so colors are mutually exclusive across both dimensions. */
export function buildColorMaps(
  ids: import("kolu-common").TerminalId[],
  getMeta: (
    id: import("kolu-common").TerminalId,
  ) => Omit<TerminalInfo, "id"> | undefined,
): { repo: Map<string, string>; branch: Map<string, string> } {
  const repoKeys = new Set<string>();
  const branchKeys = new Set<string>();
  for (const id of ids) {
    const meta = getMeta(id);
    const repo = terminalName(meta);
    if (repo) repoKeys.add(repo);
    const branch = meta?.meta?.git?.branch;
    if (branch) branchKeys.add(branch);
  }
  // Combine into one sequence so no repo and branch share a hue.
  const unified = assignColors([...repoKeys, ...branchKeys]);
  return {
    repo: new Map([...repoKeys].map((k) => [k, unified.get(k)!])),
    branch: new Map([...branchKeys].map((k) => [k, unified.get(k)!])),
  };
}

export function terminalName(
  meta: Omit<TerminalInfo, "id"> | undefined,
): string | undefined {
  return (
    meta?.meta?.git?.repoName || cwdBasename(meta?.meta?.cwd ?? "") || undefined
  );
}
