/**
 * The shape of agent-distro's package on disk, as kolu relies on it: where the
 * package keeps its commands and its versions, how a store path is shortened
 * for a tile, and how a state path baked against a placeholder home is made
 * concrete for a host. (The files a state directory holds — `current`,
 * `last-success` — are upstream's own, `@juspay/agent-distro/update/state`.) (Where kolu's floor keeps the package is the floor's own manifest —
 * `./manifest.ts` — never a layout known here.)
 *
 * Pure string algebra (POSIX store paths; no `node:path`), so the browser can
 * use the short hash and padi the rest.
 */

import { VERSIONS_FILE } from "@juspay/agent-distro/update/versions";

/** The directory a terminal gets on its PATH for the package — its `bin/`.
 *  Both kolu's floor and a host's `current` target lay their harnesses out
 *  there. */
export function agentBinDir(bundle: string): string {
  return `${bundle}/bin`;
}

/** Where the package lists its harnesses and their versions (upstream's
 *  `VERSIONS_FILE`). */
export function versionsFile(bundle: string): string {
  return `${bundle}/${VERSIONS_FILE}`;
}

/** The short hash a tile's pill shows for a store path (the package, or a
 *  built profile): the first 8 characters of
 *  its store hash (`/nix/store/<hash>-name` → `<hash>[0..8]`). Not a store path
 *  (a from-source fixture, say) → the path's last segment, cut to 8. */
export function agentBundleShortHash(bundle: string): string {
  const base = bundle.split("/").filter(Boolean).at(-1) ?? bundle;
  return base.slice(0, 8);
}

/** `path` with `placeholder` (the state home the Nix half built it against)
 *  replaced by a host's real `stateHome`. Throws if `path` is not under the
 *  placeholder — a listing not built that way would point every host at the
 *  build machine's home. */
export function concreteStatePath(
  path: string,
  placeholder: string,
  stateHome: string,
): string {
  if (!path.startsWith(placeholder))
    throw new Error(
      `agent-distro state path '${path}' is not under ${placeholder}`,
    );
  return `${stateHome}${path.slice(placeholder.length)}`;
}
