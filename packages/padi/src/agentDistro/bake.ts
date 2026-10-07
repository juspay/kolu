/**
 * The agent-distro BAKE: what a nix wrapper tells this padi about the coding
 * agents a terminal can be given. Three env vars, all written only by
 * `default.nix` (built by `nix/agent-distro.nix`):
 *
 *   - `KOLU_AGENT_DISTRO_UPDATER` (both arms) — a JSON file listing the profiles
 *     this build knows, in listing order, and per profile the updater command +
 *     config that fetches its bundle from the binary cache (agent-distro's
 *     `lib.mkUpdater`). Its profile list is the map a pushed setting is checked
 *     against; its config names the host's `current` link.
 *   - `KOLU_AGENT_DISTRO_BUNDLE` (local arm only) — the FLOOR: every profile's
 *     bundle, laid out `profiles/<name>/bin`, in this kolu's own closure. A remote
 *     host has no floor; it downloads.
 *   - `KOLU_AGENT_PLUGIN_DIR` (both arms) — this kolu's `agent-plugin`, handed to
 *     each harness as `AGENT_DISTRO_PLUGINS`.
 *
 * Like `KOLU_AGENT_TOOLS_PATH` (kolu-pty's `readAgentToolsBake`), the bake is a
 * fact the daemon is TOLD, never one it derives: a from-source padi (`just dev`,
 * e2e) has none, and says so by reading `null` — explicit absence, never a
 * guessed path. A HALF bake (the updater listing without its plugin dir, or a
 * listing that does not parse) is a broken build and throws at boot.
 *
 * All three are `KOLU_*`, so kolu-pty's `cleanEnv` strips them from every
 * terminal: a kolu started inside a kolu terminal can never inherit them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";

export const AGENT_DISTRO_UPDATER_ENV = "KOLU_AGENT_DISTRO_UPDATER";
export const AGENT_DISTRO_BUNDLE_ENV = "KOLU_AGENT_DISTRO_BUNDLE";
export const AGENT_PLUGIN_DIR_ENV = "KOLU_AGENT_PLUGIN_DIR";

/** The variable agent-distro's launchers read (its U2): colon-separated plugin
 *  directories loaded into every harness for that launch. */
export const AGENT_DISTRO_PLUGINS_ENV = "AGENT_DISTRO_PLUGINS";

/** Every bake name, for the binder that forwards them onto a padi it spawns. */
export const AGENT_DISTRO_BAKE_ENVS = [
  AGENT_DISTRO_UPDATER_ENV,
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_PLUGIN_DIR_ENV,
] as const;

/** The directory a terminal gets on its PATH for a bundle — its `bin/`. A
 *  bundle is a resolved store path (a profile dir of the floor, or a host's
 *  `current` target), and both lay their harnesses out under `bin/`. */
export function agentBinDir(bundle: string): string {
  return join(bundle, "bin");
}

/** `nix/agent-distro.nix`'s `updater` file. */
const UpdaterListingSchema = Schema.Struct({
  stateHomePlaceholder: Schema.String.check(Schema.isMinLength(1)),
  profiles: Schema.Array(
    Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(1)),
      command: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      config: Schema.String.check(Schema.isMinLength(1)),
    }),
  ).check(Schema.isMinLength(1)),
});

/** The updater config `lib.mkUpdater` writes (agent-distro's
 *  `src/update/update.ts` `Config`). Only the two path fields padi rewrites are
 *  read; the rest is passed through to the updater untouched. */
const UpdaterConfigSchema = Schema.Struct({
  state: Schema.String,
  history: Schema.String,
});

export interface AgentDistroProfileBake {
  readonly name: string;
  /** `node <tree>/src/update/update.ts` — the updater, minus its config arg. */
  readonly command: readonly string[];
  /** The baked config, verbatim, with `stateHomePlaceholder` still in it. */
  readonly configText: string;
}

export interface AgentDistroBake {
  /** The local floor (`profiles/<name>/bin` layout), or `undefined` on a host
   *  that has none and must download. */
  readonly floor: string | undefined;
  /** This kolu's `agent-plugin` directory. */
  readonly plugins: string;
  /** The placeholder the configs carry where the host's state home goes. */
  readonly stateHomePlaceholder: string;
  /** Every profile this build knows, keyed by name, in listing order. */
  readonly profiles: ReadonlyMap<string, AgentDistroProfileBake>;
}

const decodeListing = Schema.decodeUnknownSync(UpdaterListingSchema);
const decodeConfigFields = Schema.decodeUnknownSync(UpdaterConfigSchema);

/** Read the bake off `env` (injectable for tests). `null` when unbaked. */
export function readAgentDistroBake(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
): AgentDistroBake | null {
  const listingPath = env[AGENT_DISTRO_UPDATER_ENV];
  if (listingPath === undefined || listingPath === "") return null;
  const plugins = env[AGENT_PLUGIN_DIR_ENV];
  if (plugins === undefined || plugins === "") {
    throw new Error(
      `${AGENT_DISTRO_UPDATER_ENV} is baked but ${AGENT_PLUGIN_DIR_ENV} is not — a half-baked agent-distro wrapper; rebuild kolu`,
    );
  }
  const listing = decodeListing(JSON.parse(readText(listingPath)));
  const profiles = new Map<string, AgentDistroProfileBake>();
  for (const p of listing.profiles) {
    if (profiles.has(p.name)) {
      throw new Error(
        `${AGENT_DISTRO_UPDATER_ENV} (${listingPath}) lists profile '${p.name}' twice`,
      );
    }
    profiles.set(p.name, {
      name: p.name,
      command: p.command,
      configText: readText(p.config),
    });
  }
  const floor = env[AGENT_DISTRO_BUNDLE_ENV];
  return {
    floor: floor === undefined || floor === "" ? undefined : floor,
    plugins,
    stateHomePlaceholder: listing.stateHomePlaceholder,
    profiles,
  };
}

/** One profile's updater config, made concrete for THIS host: the placeholder
 *  state home replaced with `stateHome` everywhere it appears. Returns the JSON
 *  text to hand the updater and the state directory it names (whose `current`
 *  link is that profile's downloaded bundle). Throws if the baked config does not
 *  carry the placeholder in its `state` — a config not built by
 *  `nix/agent-distro.nix` would otherwise point every host at the build machine's
 *  home. */
export function hostUpdaterConfig(
  bake: Pick<AgentDistroBake, "stateHomePlaceholder">,
  profile: AgentDistroProfileBake,
  stateHome: string,
): { readonly text: string; readonly stateDir: string } {
  const raw = JSON.parse(profile.configText) as Record<string, unknown>;
  const fields = decodeConfigFields(raw);
  if (!fields.state.startsWith(bake.stateHomePlaceholder)) {
    throw new Error(
      `agent-distro updater config for '${profile.name}' has state '${fields.state}', not under ${bake.stateHomePlaceholder}`,
    );
  }
  const place = (path: string) =>
    path.split(bake.stateHomePlaceholder).join(stateHome);
  const concrete = {
    ...raw,
    state: place(fields.state),
    history: place(fields.history),
  };
  return { text: JSON.stringify(concrete), stateDir: concrete.state };
}
