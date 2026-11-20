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
   *  landing prunes. */
  readonly gcRootsDir: string;
}

/** The bake names that must appear together. All absent: this padi was built
 *  from source and has no agents. Some present: a half-baked wrapper, which
 *  cannot be read into an {@link AgentDistroBake} at all. */
function parseBakedEnv(
  env: Record<string, string | undefined>,
): { readonly statePath: string; readonly plugins: string } | null {
  const statePath = env[AGENT_DISTRO_STATE_ENV] ?? "";
  if (statePath === "") return null;
  const plugins = env[AGENT_PLUGIN_DIR_ENV] ?? "";
  if (plugins === "") {
    throw new Error(
      `${AGENT_DISTRO_STATE_ENV} is baked but ${AGENT_PLUGIN_DIR_ENV} is not — a half-baked agent-distro wrapper; rebuild kolu`,
    );
  }
  return { statePath, plugins };
}

/** Read the bake off `env` (injectable for tests). `null` when unbaked. Every
 *  path is made concrete for `stateHome` (and the GC roots for the login's
 *  `home`) HERE, once: it is then a field, not a re-substitution at every
 *  spawn. */
export function readAgentDistroBake(
  env: Record<string, string | undefined> = process.env,
  readText: (path: string) => string = (path) => readFileSync(path, "utf8"),
  stateHome: string = hostStateHome(),
  home: string = homedir(),
): AgentDistroBake | null {
  const baked = parseBakedEnv(env);
  if (baked === null) return null;
  const { statePath, plugins } = baked;
  const state = parseAgentDistroHostState(readText(statePath));
  const place = (path: string) =>
    concreteStatePath(path, state.stateHomePlaceholder, stateHome);
  const floorDir = env[AGENT_DISTRO_BUNDLE_ENV];
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
