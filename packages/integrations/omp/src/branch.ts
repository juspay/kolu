export interface BranchEntry {
  id: string;
  parentId: string | null;
  activeLeafId?: string | null;
}

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
  add(entry: BranchEntry): void;
  hasLinkage(): boolean;
  idsFromLeaf(): Generator<string>;
}

export function createOmpBranch(): OmpBranch {
  const parentOf = new Map<string, string | null>();
  let last: BranchEntry | undefined;
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
