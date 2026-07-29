/** Shared-artifact matching and coverage watchdogs for upgrade windows. */

import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { SharedArtifact } from "./sharedArtifact.ts";

export function knownDiskBasenames(
  registry: readonly SharedArtifact[],
): Set<string> {
  const names = new Set<string>();
  for (const artifact of registry) {
    for (const name of artifact.diskBasenames) names.add(name);
  }
  return names;
}

export function matchesSharedArtifact(
  registry: readonly SharedArtifact[],
  name: string,
): boolean {
  const base = basename(name);
  const exact = knownDiskBasenames(registry);
  if (exact.has(base) || exact.has(name)) return true;
  for (const artifact of registry) {
    for (const pattern of artifact.diskBasenamePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(base)) return true;
      pattern.lastIndex = 0;
      if (pattern.test(name)) return true;
    }
  }
  return false;
}

export function isSharedArtifactLog(
  registry: readonly SharedArtifact[],
  name: string,
): boolean {
  const base = basename(name);
  for (const artifact of registry) {
    if (artifact.role !== "log") continue;
    if (artifact.diskBasenames.includes(base)) return true;
    for (const pattern of artifact.diskBasenamePatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(base)) return true;
      pattern.lastIndex = 0;
      if (pattern.test(name)) return true;
    }
  }
  return (
    base.endsWith(".log") ||
    base.endsWith(".log.old") ||
    /^[\w.-]+\.log\.\d+$/.test(base)
  );
}

export function listRelativeFilesUnder(root: string): string[] {
  const names = readdirSync(root, {
    recursive: true,
    encoding: "utf8",
  }) as string[];
  return names.filter((name) => {
    try {
      const stat = statSync(join(root, name));
      return stat.isFile() || stat.isSocket();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });
}

export function unknownProtocolFilesOnDisk(
  registry: readonly SharedArtifact[],
  ...roots: readonly string[]
): string[] {
  const unknown: string[] = [];
  for (const name of roots.flatMap(listRelativeFilesUnder)) {
    if (isSharedArtifactLog(registry, name)) continue;
    if (matchesSharedArtifact(registry, name)) continue;
    unknown.push(name);
  }
  return unknown.sort();
}

export function unknownSharedFileMessage(
  registry: readonly SharedArtifact[],
  unknown: readonly string[],
): string {
  const registered = new Set(registry.map((artifact) => artifact.id));
  return (
    `Unknown shared on-disk artifact(s) under the daemon roots:\n` +
    unknown.map((name) => `  - ${name}`).join("\n") +
    `\n\nAdd an entry to the consumer's shared-artifact registry ` +
    `(currently ${registered.size} entries) with diskBasenames: [` +
    `"${unknown[0] ?? "…"}"] and a disposition test that plants version+1 ` +
    `and observes a typed state. A versionField alone is not coverage.`
  );
}

/** Coverage and inventory assertions over one consumer-owned artifact registry. */
export type SharedArtifactWatchdog = {
  coverageGaps(testFiles: ReadonlySet<string>): string[];
  assertInventory(ids: readonly string[]): void;
};

/** Factory over any consumer registry. A version field never excuses a missing
 * disposition test: `coveredByTest` must name a real suite for every protocol
 * artifact, including versioned ones. */
export function createSharedArtifactWatchdog(
  registry: readonly SharedArtifact[],
): SharedArtifactWatchdog {
  return {
    coverageGaps(testFiles) {
      const gaps: string[] = [];
      for (const artifact of registry) {
        if (artifact.role === "log") continue;
        if (artifact.coveredByTest === null) {
          gaps.push(
            `${artifact.id} (${artifact.pathShape}): register a disposition test; ` +
              `versionField=${artifact.versionField ?? "none"} does not prove the version+1 reader outcome`,
          );
          continue;
        }
        if (!testFiles.has(artifact.coveredByTest)) {
          gaps.push(
            `${artifact.id}: coveredByTest="${artifact.coveredByTest}" does not exist`,
          );
        }
      }
      return gaps;
    },
    assertInventory(ids) {
      const registered = new Set(registry.map((artifact) => artifact.id));
      const missing = ids.filter((id) => !registered.has(id));
      if (missing.length > 0) {
        throw new Error(
          `shared-artifact registry is missing required ids: ${missing.join(", ")}`,
        );
      }
    },
  };
}
