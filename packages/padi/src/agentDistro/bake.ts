/**
 * The agent-distro BAKE: what a nix wrapper tells this padi about the coding
 * agents a terminal can be given. Three env vars, all written only by
 * `default.nix`, from `@kolu/agent-distro`'s Nix half (`packages/agent-distro/default.nix`):
 *
 *   - `KOLU_AGENT_DISTRO_STATE` (both arms) — where this host keeps what kolu
 *     delivered it (`@kolu/agent-distro/bake`): the package's state directory
 *     (its `current`, which padi points at each package kolu-server delivers,
 *     and `last-success`), upstream's history log, and kolu's record of the set
 *     that landed — the package and its built profiles.
 *   - `KOLU_AGENT_DISTRO_BUNDLE` (local arm only) — the FLOOR: agent-distro's
 *     package, in this kolu's own closure, described by its manifest
 *     (`@kolu/agent-distro/manifest`). A remote host has no floor; kolu-server
 *     delivers its agents.
 *   - `KOLU_AGENT_PLUGIN_DIR` (both arms) — the `kolu-agent-plugin` copy of
 *     kolu's agent plugin, handed to each harness as `AGENT_DISTRO_PLUGINS`.
 *
 * (The fourth, `KOLU_AGENT_DISTRO_DELIVERY`, is kolu-server's alone: padi never
 * fetches or builds anything.)
 *
 * Like `KOLU_AGENT_TOOLS_PATH` (kolu-pty's `readAgentToolsBake`), the bake is a
 * fact the daemon is TOLD, never one it derives: a from-source padi (`just dev`,
 * e2e) has none, and says so by reading `null` — explicit absence, never a
 * guessed path. A HALF bake (the host state without its plugin dir, or a file
 * that does not parse) is a broken build and throws at boot.
 *
 * All three are `KOLU_*`, so kolu-pty's `cleanEnv` strips them from every
 * terminal: a kolu started inside a kolu terminal can never inherit them.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseAgentDistroHostState } from "@kolu/agent-distro/bake";
import { concreteStatePath } from "@kolu/agent-distro/bundle";
import { GC_ROOTS_DIR } from "@kolu/agent-distro/gcRoots";
import {
  type AgentDistroManifest,
  manifestFile,
  parseAgentDistroManifest,
} from "@kolu/agent-distro/manifest";
import { hostStateHome } from "./onHost.ts";

export const AGENT_DISTRO_STATE_ENV = "KOLU_AGENT_DISTRO_STATE";
export const AGENT_DISTRO_BUNDLE_ENV = "KOLU_AGENT_DISTRO_BUNDLE";
export const AGENT_PLUGIN_DIR_ENV = "KOLU_AGENT_PLUGIN_DIR";

/** The variable agent-distro's launchers read (its U2): colon-separated plugin
 *  directories loaded into every harness for that launch. */
export const AGENT_DISTRO_PLUGINS_ENV = "AGENT_DISTRO_PLUGINS";

/** The variable agent-distro's launchers read the profile stack from: the
 *  built profiles of the Agents setting, whitespace-separated, bottom to top. */
export const AI_PROFILE_ENV = "AI_PROFILE";

/** Every bake name padi reads, for the binder that forwards them onto a padi
 *  it spawns. */
export const AGENT_DISTRO_BAKE_ENVS = [
  AGENT_DISTRO_STATE_ENV,
  AGENT_DISTRO_BUNDLE_ENV,
  AGENT_PLUGIN_DIR_ENV,
] as const;

export interface AgentDistroBake {
  /** The local floor's manifest, or `undefined` on a host that has none and
   *  is delivered its agents. */
  readonly floor: AgentDistroManifest | undefined;
  /** The `kolu-agent-plugin` copy of kolu's agent plugin. */
  readonly plugins: string;
  /** The package's state directory on THIS host — made concrete for its state
   *  home once, when the bake is read. Its `current` link is the package the
   *  host serves. */
  readonly stateDir: string;
  /** The history log — upstream's, shared with its own updater. */
  readonly historyFile: string;
  /** kolu's record of the set that landed here (`@kolu/agent-distro/landing`). */
  readonly landedFile: string;
  /** Where kolu-server roots what it delivered on this host
   *  (`@kolu/agent-distro/gcRoots`, under the login's home) — the directory a
   *  landing prunes. Read once here, never reached for at call time, so
   *  whatever builds a bake owns it. */
  readonly gcRootsDir: string;
}

/** Read the bake off `env` (injectable for tests). `null` when unbaked. Every
 *  path is made concrete for `stateHome` (and the GC roots for the login's
 *  `home`) HERE, once: it is then a field, not a
 *  re-substitution at every spawn. */
export function readAgentDistroBake(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
  stateHome: string = hostStateHome(),
  home: string = homedir(),
): AgentDistroBake | null {
  const statePath = env[AGENT_DISTRO_STATE_ENV];
  if (statePath === undefined || statePath === "") return null;
  const plugins = env[AGENT_PLUGIN_DIR_ENV];
  if (plugins === undefined || plugins === "") {
    throw new Error(
      `${AGENT_DISTRO_STATE_ENV} is baked but ${AGENT_PLUGIN_DIR_ENV} is not — a half-baked agent-distro wrapper; rebuild kolu`,
    );
  }
  const state = parseAgentDistroHostState(readText(statePath));
  const place = (path: string) =>
    // Throws if the path is not under the placeholder — a file not built by
    // the Nix half would point every host at the build machine's home.
    concreteStatePath(path, state.stateHomePlaceholder, stateHome);
  const floorDir = env[AGENT_DISTRO_BUNDLE_ENV];
  // A baked floor without a readable, valid manifest is a broken build: throw.
  const floor =
    floorDir === undefined || floorDir === ""
      ? undefined
      : parseAgentDistroManifest(readText(manifestFile(floorDir)));
  return {
    floor,
    plugins,
    stateDir: place(state.state),
    historyFile: place(state.history),
    landedFile: place(state.landed),
    gcRootsDir: join(home, GC_ROOTS_DIR),
  };
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
