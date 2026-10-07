/**
 * What a terminal gets from agent-distro, and how its record remembers it — the
 * spawn-time decision. A layer is the profile, the EXACT bundle store path whose
 * `bin/` goes on PATH (the terminal pins it: a later update or profile switch
 * never touches a running terminal), and the plugin dir. The record carries the
 * profile and bundle (`agentProfile` / `agentBundle`, the tile chip); the spawn
 * reads its PATH back off the record, so the chip and the PATH are one value.
 */

import type { AgentDistroSetting } from "@kolu/agent-distro/schema";
import { agentDistroBake } from "./bake.ts";
import { bundleOnHost } from "./onHost.ts";

/** What a new terminal gets: the profile, the exact bundle (whose `bin/` goes on
 *  PATH), and the plugin dir (`AGENT_DISTRO_PLUGINS`). */
export interface AgentLayer {
  readonly profile: string;
  readonly bundle: string;
  readonly plugins: string;
}

/** The agent layer for a terminal spawned NOW, or `undefined` when it gets none
 *  (setting off, an unbaked padi, or a host whose bundle has not arrived). */
export function resolveAgentLayer(
  setting: AgentDistroSetting,
): AgentLayer | undefined {
  if (!setting.enabled) return undefined;
  const bake = agentDistroBake();
  if (bake === null) return undefined;
  const profile = bake.profiles.get(setting.profile);
  // `checkAgentDistroSetting` refuses an unknown profile at the write, and the
  // bake is fixed for the process, so this is unreachable short of a bug.
  if (profile === undefined)
    throw new Error(
      `agent-distro profile '${setting.profile}' is not in this padi's listing`,
    );
  const bundle = bundleOnHost(bake, profile);
  return bundle === undefined
    ? undefined
    : { profile: profile.name, bundle, plugins: bake.plugins };
}

/** The two record fields a layer stamps. */
interface AgentLayerFields {
  agentProfile?: string;
  agentBundle?: string;
}

/** `record` with its agent fields replaced by `layer`'s — or removed, for no
 *  layer. Never keeps a previous spawn's pair (a woken terminal's). */
export function withAgentLayer<R extends AgentLayerFields>(
  record: R,
  layer: AgentLayer | undefined,
): R {
  const { agentProfile: _profile, agentBundle: _bundle, ...rest } = record;
  return (
    layer === undefined
      ? rest
      : { ...rest, agentProfile: layer.profile, agentBundle: layer.bundle }
  ) as R;
}

/** The layer a record was stamped with, for the spawn that reads its PATH off
 *  the record. `undefined` for an unstamped record. */
export function agentLayerOfRecord(
  record: AgentLayerFields,
): AgentLayer | undefined {
  if (record.agentProfile === undefined || record.agentBundle === undefined)
    return undefined;
  const bake = agentDistroBake();
  if (bake === null)
    throw new Error(
      "a terminal record carries an agent layer, but this padi has no agent-distro bake",
    );
  return {
    profile: record.agentProfile,
    bundle: record.agentBundle,
    plugins: bake.plugins,
  };
}
