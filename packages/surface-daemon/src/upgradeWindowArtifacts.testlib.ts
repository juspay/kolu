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
  return false;
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
  coverageGaps(
    testFiles: ReadonlySet<string>,
    versionProofs?: readonly ExecutedVersionDispositionProof[],
  ): string[];
  assertInventory(ids: readonly string[]): void;
};

const EXECUTED_VERSION_DISPOSITION = Symbol("executed-version-disposition");

/** Opaque receipt issued only after a suite planted the requested version,
 * read that exact value back from disk, and observed the reader disposition. */
export type ExecutedVersionDispositionProof = {
  readonly artifactId: string;
  readonly versionField: string;
  readonly [EXECUTED_VERSION_DISPOSITION]: true;
};

/** Execute (rather than merely name) a version-disposition proof. The readback
 * prevents an empty/no-op plant callback from minting coverage. */
export async function executeVersionDispositionProof(options: {
  readonly artifact: SharedArtifact;
  readonly newerVersion: string;
  readonly plant: () => void | Promise<void>;
  readonly readPlantedVersion: () => unknown | Promise<unknown>;
  readonly observeDisposition: () => void | Promise<void>;
}): Promise<ExecutedVersionDispositionProof> {
  if (options.artifact.versionField === null) {
    throw new Error(
      `${options.artifact.id}: cannot prove a null versionField disposition`,
    );
  }
  await options.plant();
  const planted = await options.readPlantedVersion();
  if (planted !== options.newerVersion) {
    throw new Error(
      `${options.artifact.id}: version+1 plant did not execute; ` +
        `read ${JSON.stringify(planted)}, expected ${JSON.stringify(options.newerVersion)}`,
    );
  }
  await options.observeDisposition();
  return {
    artifactId: options.artifact.id,
    versionField: options.artifact.versionField,
    [EXECUTED_VERSION_DISPOSITION]: true,
  };
}

/** Factory over any consumer registry. A version field never excuses a missing
 * disposition test: `coveredByTest` must name a real suite for every protocol
 * artifact, including versioned ones. */
export function createSharedArtifactWatchdog(
  registry: readonly SharedArtifact[],
): SharedArtifactWatchdog {
  return {
    coverageGaps(testFiles, versionProofs = []) {
      const gaps: string[] = [];
      const provedVersions = new Set(
        versionProofs
          .filter((proof) => proof[EXECUTED_VERSION_DISPOSITION])
          .map((proof) => `${proof.artifactId}\0${proof.versionField}`),
      );
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
        if (
          artifact.versionField !== null &&
          !provedVersions.has(`${artifact.id}\0${artifact.versionField}`)
        ) {
          gaps.push(
            `${artifact.id}: versionField=${artifact.versionField} has no executed version+1 disposition proof`,
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
