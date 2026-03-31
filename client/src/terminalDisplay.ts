/** Terminal display info — everything needed to render a terminal in any surface.
 *  Combines server metadata with client-derived properties (colors, activity, sub-count). */

import { cwdBasename } from "./path";
import type { TerminalId, TerminalMetadata, ActivitySample } from "kolu-common";

export type TerminalDisplayInfo = {
  /** Display name (repo name or CWD basename). */
  name: string;
  repoColor?: string;
  branchColor?: string;
  meta: TerminalMetadata;
  activityHistory: ActivitySample[];
  subCount: number;
};

/** Assign OKLCH colors via golden-angle hue spacing.
 *  All keys share one sequence so no two get the same color. */
export function assignColors(keys: Iterable<string>): Map<string, string> {
  return new Map(
    [...new Set(keys)]
      .sort()
      .map((key, i) => [key, `oklch(0.75 0.14 ${(i * 137.508) % 360})`]),
  );
}

export function terminalName(meta: TerminalMetadata): string {
  return meta.git?.repoName || cwdBasename(meta.cwd) || "terminal";
}

/** Build display info for all terminals.
 *  Resolves colors from the full terminal list (global hue uniqueness)
 *  and bundles activity + sub-count so consumers get one complete object. */
export function buildTerminalDisplayInfos(
  ids: TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
  getActivityHistory: (id: TerminalId) => ActivitySample[],
  getSubTerminalIds: (id: TerminalId) => TerminalId[],
): Map<TerminalId, TerminalDisplayInfo> {
  const repoKeys = new Set<string>();
  const branchKeys = new Set<string>();
  const entries: Array<{
    id: TerminalId;
    name: string;
    meta: TerminalMetadata;
    repoKey?: string;
    branchKey?: string;
  }> = [];

  for (const id of ids) {
    const meta = getMeta(id);
    if (!meta) continue;
    const name = terminalName(meta);
    const repoKey = meta.git?.repoName || cwdBasename(meta.cwd) || undefined;
    const branchKey = meta.git?.branch;
    if (repoKey) repoKeys.add(repoKey);
    if (branchKey) branchKeys.add(branchKey);
    entries.push({ id, name, meta, repoKey, branchKey });
  }

  const unified = assignColors([...repoKeys, ...branchKeys]);
  const result = new Map<TerminalId, TerminalDisplayInfo>();
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
