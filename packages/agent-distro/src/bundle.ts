/**
 * The shape of agent-distro's bundles and state on disk, as kolu relies on it:
 * where a bundle keeps its commands, how its store path is shortened for a
 * tile, where a host's `current` link is, where kolu-server roots a bundle it
 * delivered, and how a state path baked against a placeholder home is made
 * concrete for a host. (Where kolu's floor keeps each profile is the floor's
 * own manifest — `./manifest.ts` — never a layout known here.)
 *
 * Pure string algebra (POSIX store paths; no `node:path`), so the browser can
 * use the short hash and padi the rest.
 */

/** The directory a terminal gets on its PATH for a bundle — its `bin/`. Both a
 *  profile dir of kolu's floor and a host's `current` target lay their
 *  harnesses out there. */
export function agentBinDir(bundle: string): string {
  return `${bundle}/bin`;
}

/** The link under a profile's state directory that names the bundle the host
 *  serves — agent-distro's own `current` (its shims prefer it), which padi
 *  points at each bundle kolu delivers. */
export function currentLink(stateDir: string): string {
  return `${stateDir}/current`;
}

/** The short hash a tile's pill shows for a bundle: the first 8 characters of
 *  its store hash (`/nix/store/<hash>-name` → `<hash>[0..8]`). Not a store path
 *  (a from-source fixture, say) → the path's last segment, cut to 8. */
export function agentBundleShortHash(bundle: string): string {
  const base = bundle.split("/").filter(Boolean).at(-1) ?? bundle;
  return base.slice(0, 8);
}

/** Where kolu-server roots a bundle it delivered to a host, relative to that
 *  host's home (a remote's ssh login resolves it there; the local arm anchors
 *  it to `$HOME`). One fixed link per profile: each delivery overwrites it, so
 *  the previous bundle drops out of the root set once nothing else holds it —
 *  the same "latest" semantics as `@kolu/surface-remote`'s per-agent roots. */
export function deliveryGcRootPath(profile: string): string {
  return `.local/state/kolu/agent-distro/gcroots/${profile}`;
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
