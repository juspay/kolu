/**
 * The agent-distro BAKE: what a nix wrapper tells this padi about the coding
 * agents a terminal can be given. Three env vars, all written only by
 * `default.nix`, from `@kolu/agent-distro`'s Nix half (`packages/agent-distro/default.nix`):
 *
 *   - `KOLU_AGENT_DISTRO_UPDATER` (both arms) — a JSON file listing the profiles
 *     this build knows, in listing order, and per profile the updater command +
 *     config that fetches its bundle from the binary cache (agent-distro's
 *     `lib.mkUpdater`). Its profile list is the map a pushed setting is checked
 *     against; its config names the host's `current` link.
 *   - `KOLU_AGENT_DISTRO_BUNDLE` (local arm only) — the FLOOR: every profile's
 *     bundle, in this kolu's own closure, described by its manifest
 *     (`@kolu/agent-distro/manifest`). A remote host has no floor; it downloads.
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
import { concreteUpdaterConfig } from "@kolu/agent-distro/bundle";
import {
  type UpdaterSchedule,
  updaterScheduleOf,
} from "@kolu/agent-distro/schedule";
import {
  type AgentDistroManifest,
  manifestFile,
  parseAgentDistroManifest,
} from "@kolu/agent-distro/manifest";
import { Schema } from "effect";
import { hostStateHome } from "./onHost.ts";

export const AGENT_DISTRO_UPDATER_ENV = "KOLU_AGENT_DISTRO_UPDATER";
export const AGENT_DISTRO_BUNDLE_ENV = "KOLU_AGENT_DISTRO_BUNDLE";
export const AGENT_PLUGIN_DIR_ENV = "KOLU_AGENT_PLUGIN_DIR";

/** The variable agent-distro's launchers read (its U2): colon-separated plugin
 *  directories loaded into every harness for that launch. */
export const AGENT_DISTRO_PLUGINS_ENV = "AGENT_DISTRO_PLUGINS";

/** The variable agent-distro's launchers fall back to for the profile (after a
 *  positional argument and the repository's own `agent-distro.nix`): a
 *  reference, set on a terminal only when the Agents setting names one. */
export const AI_PROFILE_ENV = "AI_PROFILE";

/** Every bake name, for the binder that forwards them onto a padi it spawns. */
export const AGENT_DISTRO_BAKE_ENVS = [
  AGENT_DISTRO_UPDATER_ENV,
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_PLUGIN_DIR_ENV,
] as const;

/** The Nix half's `updater` file. */
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

export interface AgentDistroProfileBake {
  readonly name: string;
  /** `node <tree>/src/update/update.ts` — `lib.mkUpdater`'s `command` with its
   *  trailing build-time config path removed (the Nix half asserts it was
   *  there); padi appends the host-concrete config instead. */
  readonly command: readonly string[];
  /** The updater config made concrete for THIS host — the placeholder state
   *  home replaced by the host's own, ONCE, when the bake is read. */
  readonly configText: string;
  /** The state directory that config names (its `current` link is the
   *  profile's downloaded bundle) — computed with `configText`, never again. */
  readonly stateDir: string;
  /** The history log that config names — where the updater writes what each
   *  run did (shared by every profile on the host). */
  readonly historyFile: string;
  /** When an update is due — upstream's schedule, as the config carries it. */
  readonly schedule: UpdaterSchedule;
}

export interface AgentDistroBake {
  /** The local floor's manifest, or `undefined` on a host that has none and
   *  must download. */
  readonly floor: AgentDistroManifest | undefined;
  /** This kolu's `agent-plugin` directory. */
  readonly plugins: string;
  /** Every profile this build knows, keyed by name, in listing order. */
  readonly profiles: ReadonlyMap<string, AgentDistroProfileBake>;
}

const decodeListing = Schema.decodeUnknownSync(UpdaterListingSchema);

/** Read the bake off `env` (injectable for tests). `null` when unbaked. Each
 *  profile's updater config is made concrete for `stateHome` HERE, once: its
 *  state directory is then a field, not a re-parse at every spawn. */
export function readAgentDistroBake(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
  stateHome: string = hostStateHome(),
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
    // Throws if the baked config does not keep its state under the
    // placeholder — a config not built by the Nix half would point every host
    // at the build machine's home.
    const concrete = concreteUpdaterConfig(
      readText(p.config),
      listing.stateHomePlaceholder,
      stateHome,
    );
    profiles.set(p.name, {
      name: p.name,
      command: p.command,
      configText: concrete.text,
      stateDir: concrete.stateDir,
      historyFile: concrete.historyFile,
      // Throws on a config without upstream's schedule: a broken build.
      schedule: updaterScheduleOf(concrete.text),
    });
  }
  const floorDir = env[AGENT_DISTRO_BUNDLE_ENV];
  // A baked floor without a readable, valid manifest is a broken build: throw.
  const floor =
    floorDir === undefined || floorDir === ""
      ? undefined
      : parseAgentDistroManifest(readText(manifestFile(floorDir)));
  return { floor, plugins, profiles };
}

// ── This process's bake ───────────────────────────────────────────────

let bakeMemo: { value: AgentDistroBake | null } | undefined;

/** This process's bake, read once. Called at boot by `servePadi` so a broken
 *  bake crashes the daemon there, not at the first spawn. */
export function agentDistroBake(): AgentDistroBake | null {
  bakeMemo ??= { value: readAgentDistroBake() };
  return bakeMemo.value;
}

/** Test seam: replace (or clear, with `undefined`) the memoized bake. */
export function __setAgentDistroBakeForTest(
  bake: AgentDistroBake | null | undefined,
): void {
  bakeMemo = bake === undefined ? undefined : { value: bake };
}
