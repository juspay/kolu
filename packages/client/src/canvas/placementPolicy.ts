import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { TerminalStore } from "../terminal/useTerminalStore";

export function getBucketFor(
  store: TerminalStore,
  id: TerminalId,
): string | undefined {
  return store.getDisplayInfo(id)?.key.group;
}

export function resolvePlacementBucket(
  store: TerminalStore,
  id: TerminalId,
  candidateIds: TerminalId[],
): string | undefined {
  const ownBucket = getBucketFor(store, id);
  if (
    ownBucket &&
    candidateIds.some((c) => getBucketFor(store, c) === ownBucket)
  ) {
    return ownBucket;
  }
  const cwd = store.getMetadata(id)?.cwd;
  if (!cwd) return ownBucket;
  return resolveByContainment(store, cwd, candidateIds) ?? ownBucket;
}

function resolveByContainment(
  store: TerminalStore,
  cwd: string,
  candidateIds: TerminalId[],
): string | undefined {
  let best: { bucket: string; rootLength: number } | undefined;
  for (const candidate of candidateIds) {
    const bucket = getBucketFor(store, candidate);
    if (!bucket) continue;
    for (const root of candidateRootsFor(store.getMetadata(candidate))) {
      if (cwd !== root && !cwd.startsWith(`${root}/`)) continue;
      if (!best || root.length > best.rootLength) {
        best = { bucket, rootLength: root.length };
      }
    }
  }
  return best?.bucket;
}

function candidateRootsFor(
  meta: TerminalMetadata | undefined,
): readonly string[] {
  if (meta?.git.kind !== "repo") return [];
  const git = meta.git.info;
  const roots = new Set<string>();
  if (git.repoRoot) roots.add(git.repoRoot);
  if (git.mainRepoRoot) roots.add(git.mainRepoRoot);
  return [...roots];
}
