/** Terminal display info — everything needed to render a terminal in any surface.
 *  Combines server metadata with client-derived properties (colors, sub-count,
 *  identity key). */

import { cwdBasename } from "../path";
import {
  computeTerminalKeys,
  type TerminalId,
  type TerminalKey,
  type TerminalMetadata,
} from "kolu-common";

export type TerminalDisplayInfo = {
  /** Display name (repo name or CWD basename). */
  name: string;
  repoColor?: string;
  branchColor?: string;
  meta: TerminalMetadata;
  subCount: number;
  /** Collision-aware identity key. `suffix` is set only when another
   *  terminal in the same display set shares `(group, label)`. */
  key: TerminalKey;
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

/** Build display info for all terminals. Resolves colors from the full
 *  terminal list (global hue uniqueness), computes collision-aware
 *  identity keys in one pass (`computeTerminalKeys`), and bundles
 *  sub-count so consumers get one complete object. Pure — same inputs
 *  produce the same outputs on every client, so suffixes stay in sync
 *  without server broadcast. */
export function buildTerminalDisplayInfos(
  ids: TerminalId[],
  getMeta: (id: TerminalId) => TerminalMetadata | undefined,
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
  const keys = computeTerminalKeys(
    entries.map(({ id, meta }) => ({ id, git: meta.git, cwd: meta.cwd })),
  );
  const result = new Map<TerminalId, TerminalDisplayInfo>();
  for (const { id, name, meta, repoKey, branchKey } of entries) {
    result.set(id, {
      name,
      meta,
      repoColor: repoKey ? unified.get(repoKey) : undefined,
      branchColor: branchKey ? unified.get(branchKey) : undefined,
      subCount: getSubTerminalIds(id).length,
      key: keys.get(id)!,
    });
  }
  return result;
}
