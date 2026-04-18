/** Pill-tree ordering — group terminals by repo, preserve sortOrder within
 *  each repo. Single source for both `PillTree` visualization and the
 *  mobile swipe-cycle handler so the two views never diverge. */

import type { TerminalId, TerminalMetadata } from "kolu-common";
import { cwdBasename } from "../path";
import { terminalName } from "../terminal/terminalDisplay";

export interface PillRepoGroup {
  repoName: string;
  branches: Array<{
    id: TerminalId;
    /** Display label — branch name when known, falls back to terminal name. */
    label: string;
  }>;
}

/** Group ids by repoName (or cwd basename for non-git terminals). Preserves
 *  the input order within each group — caller passes ids already sorted by
 *  sortOrder, so groups inherit creation order. */
export function groupByRepo(
  ids: TerminalId[],
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined,
): PillRepoGroup[] {
  const order: string[] = [];
  const groups = new Map<string, PillRepoGroup>();
  for (const id of ids) {
    const meta = getMetadata(id);
    if (!meta) continue;
    const repoName = meta.git?.repoName || cwdBasename(meta.cwd) || "terminal";
    let group = groups.get(repoName);
    if (!group) {
      group = { repoName, branches: [] };
      groups.set(repoName, group);
      order.push(repoName);
    }
    group.branches.push({
      id,
      label: meta.git?.branch ?? terminalName(meta),
    });
  }
  return order.map((name) => groups.get(name)!);
}

/** Flat traversal of the grouped order — used by mobile swipe to cycle
 *  through tiles in the same sequence the pill tree would walk. */
export function flatPillOrder(groups: PillRepoGroup[]): TerminalId[] {
  return groups.flatMap((g) => g.branches.map((b) => b.id));
}
