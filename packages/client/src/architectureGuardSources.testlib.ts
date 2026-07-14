/**
 * Shared source enumerator for the architectural GUARD tests
 * (`procedureCastGuard`, `canvasBoundaryGuard`, `standingSubscriptionOwnership`).
 *
 * Each guard scans the `packages/client/src` tree (or a sub-target) for a
 * forbidden pattern; they only differ in WHAT they scan for, not in HOW they
 * enumerate files. Keeping the walk in ONE place means a future change to the
 * enumeration (a new ignore, a filename-filter tweak) lands once instead of
 * drifting across three near-identical copies.
 */

import { globSync, statSync } from "node:fs";
import { join } from "node:path";

/** A non-test `.ts`/`.tsx` SOURCE file — not `*.test.ts` / `*.test-d.ts` /
 *  `*.test.tsx`. */
const isSourceFile = (p: string): boolean =>
  /\.tsx?$/.test(p) && !/\.test(-d)?\.tsx?$/.test(p);

/** Every non-test `.ts`/`.tsx` source file under a target — a directory subtree
 *  OR a single file. Test files and `node_modules` are excluded; a non-source or
 *  excluded single-file target yields `[]`. The directory walk uses Node's own
 *  focused `fs.globSync` rather than a hand-rolled `readdirSync` recursion. */
export function listGuardSourceFiles(target: string): string[] {
  // A single-file target (e.g. canvasBoundaryGuard's `useViewState.ts`).
  if (!statSync(target).isDirectory())
    return isSourceFile(target) ? [target] : [];
  return globSync("**/*.{ts,tsx}", {
    cwd: target,
    exclude: (p) => p.includes("node_modules"),
  })
    .filter(isSourceFile)
    .map((rel) => join(target, rel));
}
