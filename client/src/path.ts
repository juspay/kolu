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

/** Build a map from key → unique OKLCH color via golden-angle hue spacing. */
export function buildColorMap(keys: Iterable<string>): Map<string, string> {
  return new Map(
    [...new Set(keys)]
      .sort()
      .map((key, i) => [key, `oklch(0.75 0.14 ${(i * 137.508) % 360})`]),
  );
}

/** Build repo-name → color map from terminal list. */
export function buildRepoColorMap(
  ids: import("kolu-common").TerminalId[],
  getMeta: (
    id: import("kolu-common").TerminalId,
  ) => Omit<TerminalInfo, "id"> | undefined,
): Map<string, string> {
  const keys: string[] = [];
  for (const id of ids) {
    const key = terminalName(getMeta(id));
    if (key) keys.push(key);
  }
  return buildColorMap(keys);
}

/** Build branch-name → color map from terminal list. */
export function buildBranchColorMap(
  ids: import("kolu-common").TerminalId[],
  getMeta: (
    id: import("kolu-common").TerminalId,
  ) => Omit<TerminalInfo, "id"> | undefined,
): Map<string, string> {
  const keys: string[] = [];
  for (const id of ids) {
    const branch = getMeta(id)?.meta?.git?.branch;
    if (branch) keys.push(branch);
  }
  return buildColorMap(keys);
}

export function terminalName(
  meta: Omit<TerminalInfo, "id"> | undefined,
): string | undefined {
  return (
    meta?.meta?.git?.repoName || cwdBasename(meta?.meta?.cwd ?? "") || undefined
  );
}
