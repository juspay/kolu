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

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every non-test `.ts`/`.tsx` source file under a target — a directory subtree
 *  OR a single file. Test files (`*.test.ts`, `*.test-d.ts`, `*.test.tsx`) and
 *  `node_modules` are excluded; a non-source or excluded single-file target yields
 *  `[]`. Recurses depth-first. */
export function listGuardSourceFiles(target: string): string[] {
  const st = statSync(target);
  if (!st.isDirectory()) {
    if (!/\.tsx?$/.test(target) || /\.test(-d)?\.tsx?$/.test(target)) return [];
    return [target];
  }
  const out: string[] = [];
  for (const name of readdirSync(target)) {
    if (name === "node_modules") continue;
    out.push(...listGuardSourceFiles(join(target, name)));
  }
  return out;
}
