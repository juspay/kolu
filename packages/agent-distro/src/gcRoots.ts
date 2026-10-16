/**
 * Where kolu roots what it delivered on a host, so Nix's garbage collection
 * leaves it: one indirect GC root for the package and one per profile of the
 * stack, under the login's home (over ssh the login's home is the one place
 * kolu-server can name on a host). kolu-server writes them as each piece
 * lands; padi, on the host, removes a profile's root once the stack it lands
 * no longer names that profile — so only what serves stays protected.
 *
 * A root is a symlink in this directory; removing it is all it takes for the
 * collector to stop honouring it.
 */

import { createHash } from "node:crypto";

/** The roots' directory, relative to the login's home. */
export const GC_ROOTS_DIR = ".local/state/kolu/agent-distro/gcroots";

/** The package's root's name. */
export const PACKAGE_GC_ROOT = "package";

/** One profile's root's name — by its reference, hashed, since a reference
 *  is free text (a path, a flake reference with a query). */
export function profileGcRoot(reference: string): string {
  return `profile-${createHash("sha256").update(reference).digest("hex").slice(0, 16)}`;
}

/** The roots in `names` (a listing of {@link GC_ROOTS_DIR}) to remove once
 *  a stack lands: everything but the package's and those of the profiles
 *  `keep` names — the landed stack and the setting's current one, since a
 *  delivery of the latter may be running beside it. That includes roots an
 *  older kolu wrote by a per-profile bundle's bare name (`vanilla`): the
 *  directory is kolu's alone, and nothing else it holds still serves. */
export function staleGcRoots(
  names: readonly string[],
  keep: readonly string[],
): readonly string[] {
  const kept = new Set([PACKAGE_GC_ROOT, ...keep.map(profileGcRoot)]);
  return names.filter((n) => !kept.has(n));
}
