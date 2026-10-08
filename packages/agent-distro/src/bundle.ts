/**
 * The shape of agent-distro's bundles and state on disk, as kolu relies on it:
 * where a bundle keeps its commands, how its store path is shortened for a
 * tile, and how a host's state directory is named in the updater config
 * `lib.mkUpdater` writes. (Where kolu's floor keeps each profile is the floor's
 * own manifest — `./manifest.ts` — never a layout known here.)
 *
 * Pure string algebra (POSIX store paths; no `node:path`), so the browser can
 * use the short hash and padi the rest.
 */

import { Schema } from "effect";

/** The directory a terminal gets on its PATH for a bundle — its `bin/`. Both a
 *  profile dir of kolu's floor and a host's `current` target lay their
 *  harnesses out there. */
export function agentBinDir(bundle: string): string {
  return `${bundle}/bin`;
}

/** The link agent-distro's updater flips, under a state directory, to the
 *  bundle it last fetched. */
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

/** The two path fields of `lib.mkUpdater`'s config (agent-distro's
 *  `src/update/update.ts` `Config`) that name a host's state. */
const UpdaterConfigPathsSchema = Schema.Struct({
  state: Schema.String,
  history: Schema.String,
});
const decodeConfigPaths = Schema.decodeUnknownSync(UpdaterConfigPathsSchema);

/** An updater config made concrete for one host: `placeholder` (the state home
 *  the config was built against) replaced with the host's real `stateHome` in
 *  `state` and `history`; every other field passed through untouched. Returns
 *  the JSON to hand the updater and the state directory it names. Throws if
 *  `state` is not under the placeholder — a config not built that way would
 *  point every host at the build machine's home. */
export function concreteUpdaterConfig(
  configText: string,
  placeholder: string,
  stateHome: string,
): { readonly text: string; readonly stateDir: string } {
  const raw = JSON.parse(configText) as Record<string, unknown>;
  const fields = decodeConfigPaths(raw);
  if (!fields.state.startsWith(placeholder)) {
    throw new Error(
      `agent-distro updater config has state '${fields.state}', not under ${placeholder}`,
    );
  }
  const place = (path: string) => path.split(placeholder).join(stateHome);
  const concrete = {
    ...raw,
    state: place(fields.state),
    history: place(fields.history),
  };
  return { text: JSON.stringify(concrete), stateDir: concrete.state };
}
