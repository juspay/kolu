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

/** Everything needed to display a terminal in any surface (sidebar, mission control, etc.).
 *  Combines server metadata with client-derived display properties (colors, activity, sub-count). */
export type TerminalDisplayInfo = {
  /** Display name (repo name or CWD basename). */
  name: string;
  repoColor?: string;
  branchColor?: string;
  meta: import("kolu-common").TerminalMetadata;
  activityHistory: ActivitySample[];
  subCount: number;
};

import type { ActivitySample } from "./useTerminals";

/** Build display info for all terminals.
 *  Resolves colors from the full terminal list (global hue uniqueness)
 *  and bundles activity + sub-count so consumers get one complete object. */
export function buildTerminalDisplayInfos(
  ids: import("kolu-common").TerminalId[],
  getMeta: (
    id: import("kolu-common").TerminalId,
  ) => Omit<TerminalInfo, "id"> | undefined,
  getActivityHistory: (
    id: import("kolu-common").TerminalId,
  ) => ActivitySample[],
  getSubTerminalIds: (
    id: import("kolu-common").TerminalId,
  ) => import("kolu-common").TerminalId[],
): Map<import("kolu-common").TerminalId, TerminalDisplayInfo> {
  const repoKeys = new Set<string>();
  const branchKeys = new Set<string>();
  const entries: Array<{
    id: import("kolu-common").TerminalId;
    name: string;
    meta: import("kolu-common").TerminalMetadata;
    repoKey?: string;
    branchKey?: string;
  }> = [];

  for (const id of ids) {
    const info = getMeta(id);
    if (!info?.meta) continue;
    const name = terminalName(info) ?? "terminal";
    const repoKey =
      info.meta.git?.repoName || cwdBasename(info.meta.cwd) || undefined;
    const branchKey = info.meta.git?.branch;
    if (repoKey) repoKeys.add(repoKey);
    if (branchKey) branchKeys.add(branchKey);
    entries.push({ id, name, meta: info.meta, repoKey, branchKey });
  }

  const unified = assignColors([...repoKeys, ...branchKeys]);
  const result = new Map<
    import("kolu-common").TerminalId,
    TerminalDisplayInfo
  >();
  for (const { id, name, meta, repoKey, branchKey } of entries) {
    result.set(id, {
      name,
      meta,
      repoColor: repoKey ? unified.get(repoKey) : undefined,
      branchColor: branchKey ? unified.get(branchKey) : undefined,
      activityHistory: getActivityHistory(id),
      subCount: getSubTerminalIds(id).length,
    });
  }
  return result;
}

function terminalName(
  meta: Omit<TerminalInfo, "id"> | undefined,
): string | undefined {
  return (
    meta?.meta?.git?.repoName || cwdBasename(meta?.meta?.cwd ?? "") || undefined
  );
}
