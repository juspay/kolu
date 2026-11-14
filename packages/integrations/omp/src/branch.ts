/** omp's active branch — which entries of a session file are the live
 *  conversation.
 *
 *  omp's entries form a tree (`id` / `parentId`): `/tree` and `/branch` move
 *  the conversation back to an earlier entry, and the abandoned turns stay in
 *  the file. The live conversation is the path from the LEAF to the root. The
 *  leaf is not simply the file's last line: omp appends some entries off to the
 *  side of the conversation — a `model_usage` entry hangs off the turn it
 *  accounts for, often an older entry — and records the real leaf on them as
 *  `activeLeafId`. This module mirrors omp's own rule for reading the leaf
 *  back from a file (omp 18.18's `resolveSessionLeafId`):
 *
 *   - the last entry names the leaf: its `activeLeafId` when it carries one
 *     (`null` meaning "before the first entry"), else its own `id`;
 *   - a named leaf that is not in the file falls back to the newest entry that
 *     named ITSELF as the leaf.
 *
 *  Reading from the last line instead drops the newest turn whenever a
 *  `model_usage` entry is the last line — on real sessions, its whole
 *  assistant reply and tool results, for up to a minute until the next entry
 *  lands.
 *
 *  `session` header lines are not entries (omp keeps the header apart from
 *  them), nor are lines without an `id` (the line-1 title slot). */

/** The fields of an entry the branch is built from. */
export interface BranchEntry {
  id: string;
  parentId: string | null;
  /** Set only when the entry is appended off the conversation: the leaf at
   *  that moment. */
  activeLeafId?: string | null;
}

/** The branch fields of one parsed line, or `undefined` for a line that is not
 *  an entry (the title slot, the `session` header, a malformed line). */
export function branchEntryOf(value: unknown): BranchEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("id" in value) || typeof value.id !== "string") return undefined;
  if ("type" in value && value.type === "session") return undefined;
  const parentId =
    "parentId" in value && typeof value.parentId === "string"
      ? value.parentId
      : null;
  if (!("activeLeafId" in value)) return { id: value.id, parentId };
  const { activeLeafId } = value;
  return {
    id: value.id,
    parentId,
    activeLeafId: typeof activeLeafId === "string" ? activeLeafId : null,
  };
}

export interface OmpBranch {
  /** Add the next entry, in file order. */
  add(entry: BranchEntry): void;
  /** Whether any entry's `parentId` names an entry in the file — false for a
   *  file whose entries carry no tree at all. */
  hasLinkage(): boolean;
  /** The ids of the active branch, leaf first. */
  idsFromLeaf(): Generator<string>;
}

/** An active-branch tracker, fed one entry at a time — the transcript export
 *  feeds a whole file, the todo reader feeds each append. */
export function createOmpBranch(): OmpBranch {
  const parentOf = new Map<string, string | null>();
  let last: BranchEntry | undefined;
  /** The newest entry whose leaf is itself — omp's fallback leaf. */
  let lastSelfSelected: string | null = null;
  let linked = false;

  function leafId(): string | null {
    if (last === undefined) return null;
    const named = last.activeLeafId === undefined ? last.id : last.activeLeafId;
    if (named === null || named === last.id || parentOf.has(named)) {
      return named;
    }
    return lastSelfSelected;
  }

  return {
    add(entry) {
      parentOf.set(entry.id, entry.parentId);
      if (entry.activeLeafId === undefined || entry.activeLeafId === entry.id) {
        lastSelfSelected = entry.id;
      }
      if (entry.parentId !== null && parentOf.has(entry.parentId)) {
        linked = true;
      }
      last = entry;
    },
    hasLinkage: () => linked,
    *idsFromLeaf() {
      const seen = new Set<string>();
      let cursor = leafId();
      while (cursor !== null && parentOf.has(cursor) && !seen.has(cursor)) {
        seen.add(cursor);
        yield cursor;
        cursor = parentOf.get(cursor) ?? null;
      }
    },
  };
}
