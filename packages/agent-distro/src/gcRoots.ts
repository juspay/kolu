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

const PROFILE_PREFIX = "profile-";

/** One profile's root's name — by its reference, hashed, since a reference
 *  is free text (a path, a flake reference with a query). */
export function profileGcRoot(reference: string): string {
  return `${PROFILE_PREFIX}${createHash("sha256").update(reference).digest("hex").slice(0, 16)}`;
}

/** The profile roots in `names` (a listing of {@link GC_ROOTS_DIR}) that the
 *  stack `references` no longer names — the ones to remove when it lands. */
export function staleProfileRoots(
  names: readonly string[],
  references: readonly string[],
): readonly string[] {
  const keep = new Set(references.map(profileGcRoot));
  return names.filter((n) => n.startsWith(PROFILE_PREFIX) && !keep.has(n));
}
