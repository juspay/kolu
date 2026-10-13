/**
 * The agent-distro BAKE: what a nix wrapper tells this padi about the coding
 * agents a terminal can be given. Three env vars, all written only by
 * `default.nix`, from `@kolu/agent-distro`'s Nix half (`packages/agent-distro/default.nix`):
 *
 *   - `KOLU_AGENT_DISTRO_PROFILES` (both arms) — the profiles this build knows,
 *     in listing order, each with the state directory its `current` lives
 *     under on a host (`@kolu/agent-distro/bake`). Its profile list is the map
 *     a pushed setting is checked against; its state directories are where
 *     padi points `current` at each bundle kolu-server delivers.
 *   - `KOLU_AGENT_DISTRO_BUNDLE` (local arm only) — the FLOOR: every profile's
 *     bundle, in this kolu's own closure, described by its manifest
 *     (`@kolu/agent-distro/manifest`). A remote host has no floor; kolu-server
 *     delivers its agents.
 *   - `KOLU_AGENT_PLUGIN_DIR` (both arms) — this kolu's `agent-plugin`, handed to
 *     each harness as `AGENT_DISTRO_PLUGINS`.
 *
 * (The fourth, `KOLU_AGENT_DISTRO_DELIVERY`, is kolu-server's alone: padi never
 * fetches anything.)
 *
 * Like `KOLU_AGENT_TOOLS_PATH` (kolu-pty's `readAgentToolsBake`), the bake is a
 * fact the daemon is TOLD, never one it derives: a from-source padi (`just dev`,
 * e2e) has none, and says so by reading `null` — explicit absence, never a
 * guessed path. A HALF bake (the profiles listing without its plugin dir, or a
 * listing that does not parse) is a broken build and throws at boot.
 *
 * All three are `KOLU_*`, so kolu-pty's `cleanEnv` strips them from every
 * terminal: a kolu started inside a kolu terminal can never inherit them.
 */

import { readFileSync } from "node:fs";
import { parseAgentDistroProfiles } from "@kolu/agent-distro/bake";
import { concreteStatePath } from "@kolu/agent-distro/bundle";
import {
  type AgentDistroManifest,
  manifestFile,
  parseAgentDistroManifest,
} from "@kolu/agent-distro/manifest";
import { hostStateHome } from "./onHost.ts";

export const AGENT_DISTRO_PROFILES_ENV = "KOLU_AGENT_DISTRO_PROFILES";
export const AGENT_DISTRO_BUNDLE_ENV = "KOLU_AGENT_DISTRO_BUNDLE";
export const AGENT_PLUGIN_DIR_ENV = "KOLU_AGENT_PLUGIN_DIR";

/** The variable agent-distro's launchers read (its U2): colon-separated plugin
 *  directories loaded into every harness for that launch. */
export const AGENT_DISTRO_PLUGINS_ENV = "AGENT_DISTRO_PLUGINS";

/** The variable agent-distro's launchers fall back to for the profile (after a
 *  positional argument and the repository's own `agent-distro.nix`): the
 *  Agents setting's profile, on every terminal that gets agents. */
export const AI_PROFILE_ENV = "AI_PROFILE";

/** Every bake name padi reads, for the binder that forwards them onto a padi
 *  it spawns. */
export const AGENT_DISTRO_BAKE_ENVS = [
  AGENT_DISTRO_PROFILES_ENV,
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_PLUGIN_DIR_ENV,
] as const;

export interface AgentDistroProfileBake {
  readonly name: string;
  /** The state directory this host keeps the profile under — the listing's,
   *  made concrete for THIS host's state home once, when the bake is read. Its
   *  `current` link is the bundle the host serves. */
  readonly stateDir: string;
  /** The history log — upstream's, shared by every profile on the host. */
  readonly historyFile: string;
}

export interface AgentDistroBake {
  /** The local floor's manifest, or `undefined` on a host that has none and
   *  is delivered its agents. */
  readonly floor: AgentDistroManifest | undefined;
  /** This kolu's `agent-plugin` directory. */
  readonly plugins: string;
  /** Every profile this build knows, keyed by name, in listing order. */
  readonly profiles: ReadonlyMap<string, AgentDistroProfileBake>;
}

/** Read the bake off `env` (injectable for tests). `null` when unbaked. Each
 *  profile's state directory is made concrete for `stateHome` HERE, once: it
 *  is then a field, not a re-substitution at every spawn. */
export function readAgentDistroBake(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
  stateHome: string = hostStateHome(),
): AgentDistroBake | null {
  const listingPath = env[AGENT_DISTRO_PROFILES_ENV];
  if (listingPath === undefined || listingPath === "") return null;
  const plugins = env[AGENT_PLUGIN_DIR_ENV];
  if (plugins === undefined || plugins === "") {
    throw new Error(
      `${AGENT_DISTRO_PROFILES_ENV} is baked but ${AGENT_PLUGIN_DIR_ENV} is not — a half-baked agent-distro wrapper; rebuild kolu`,
    );
  }
  const listing = parseAgentDistroProfiles(readText(listingPath));
  const place = (path: string) =>
    // Throws if the path is not under the placeholder — a listing not built by
    // the Nix half would point every host at the build machine's home.
    concreteStatePath(path, listing.stateHomePlaceholder, stateHome);
  const historyFile = place(listing.history);
  const profiles = new Map<string, AgentDistroProfileBake>();
  for (const p of listing.profiles) {
    if (profiles.has(p.name)) {
      throw new Error(
        `${AGENT_DISTRO_PROFILES_ENV} (${listingPath}) lists profile '${p.name}' twice`,
      );
    }
    profiles.set(p.name, {
      name: p.name,
      stateDir: place(p.state),
      historyFile,
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
