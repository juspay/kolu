/** Pill-tree ordering — group terminals by repo, preserve sortOrder within
 *  each repo. Single source for both `PillTree` visualization and the
 *  mobile swipe-cycle handler so the two views never diverge. */

import type { TerminalId } from "kolu-common";
import { cwdBasename } from "../path";
import {
  terminalName,
  type TerminalDisplayInfo,
} from "../terminal/terminalDisplay";

export interface PillBranch {
  id: TerminalId;
  /** Display label — branch name when known, falls back to terminal name. */
  label: string;
  /** Short id-prefix suffix ("#a3f2") shown after the label when this
   *  terminal collides on identity with another (same repo+branch, or
   *  same cwd for non-git). Mirrors `TerminalDisplayInfo.displaySuffix`. */
  suffix?: string;
}

export interface PillRepoGroup {
  repoName: string;
  branches: PillBranch[];
}

/** Group ids by repoName (or cwd basename for non-git terminals). Preserves
 *  the input order within each group — caller passes ids already sorted by
 *  sortOrder, so groups inherit creation order. Reads `displaySuffix`
 *  from `getDisplayInfo` so collision suffixes appear on pill labels
 *  exactly where they appear on tile titles (single source of truth). */
export function groupByRepo(
  ids: TerminalId[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
): PillRepoGroup[] {
  const order: string[] = [];
  const groups = new Map<string, PillRepoGroup>();
  for (const id of ids) {
    const info = getDisplayInfo(id);
    if (!info) continue;
    const meta = info.meta;
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
      suffix: info.displaySuffix,
    });
  }
  return order.map((name) => groups.get(name)!);
}

/** Flat traversal of the grouped order — used by mobile swipe to cycle
 *  through tiles in the same sequence the pill tree would walk. */
export function flatPillOrder(groups: PillRepoGroup[]): TerminalId[] {
  return groups.flatMap((g) => g.branches.map((b) => b.id));
}
