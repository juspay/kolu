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

/** Derive terminal identity: repo name > cwd basename > undefined.
 *  Used for color-grouping (Sidebar) and display labels (MissionControl). */
/** Build a map from terminal name → unique OKLCH color via golden-angle hue spacing. */
export function buildRepoColorMap(
  ids: import("kolu-common").TerminalId[],
  getMeta: (
    id: import("kolu-common").TerminalId,
  ) => Omit<TerminalInfo, "id"> | undefined,
): Map<string, string> {
  const keys = new Set<string>();
  for (const id of ids) {
    const key = terminalName(getMeta(id));
    if (key) keys.add(key);
  }
  return new Map(
    [...keys]
      .sort()
      .map((key, i) => [key, `oklch(0.75 0.14 ${(i * 137.508) % 360})`]),
  );
}

export function terminalName(
  meta: Omit<TerminalInfo, "id"> | undefined,
): string | undefined {
  return (
    meta?.meta?.git?.repoName || cwdBasename(meta?.meta?.cwd ?? "") || undefined
  );
}
