/**
 * What a terminal gets from agent-distro, and how its record remembers it — the
 * spawn-time facts. A layer is the profile, the EXACT bundle store path whose
 * `bin/` goes on PATH (the terminal pins it: a later update or profile switch
 * never touches a running terminal), and the plugin dir. The record carries the
 * profile and bundle (`agents`, the tile pill); the spawn
 * reads its PATH back off the record, so the chip and the PATH are one value.
 */

import {
  type AgentDistroSetting,
  bundleProfileOf,
  type TerminalAgents,
} from "@kolu/agent-distro/schema";
import { agentDistroBake } from "./bake.ts";
import { bundleOnHost } from "./onHost.ts";

/** What a new terminal gets: the profile, the exact bundle (whose `bin/` goes on
 *  PATH), and the plugin dir (`AGENT_DISTRO_PLUGINS`). */
export interface AgentLayer {
  /** The setting's profile: a built-in name, or a reference — then `bundle`
   *  is its bundle profile's (`bundleProfileOf`) and the spawn exports the
   *  reference as `AI_PROFILE`. */
  readonly profile: string;
  readonly bundle: string;
  readonly plugins: string;
}

/** The layer the bundle ON DISK would give, or `undefined` when there is none
 *  (setting off, an unbaked padi, or a host whose bundle has not arrived). NOT
 *  what a new terminal gets: that also hangs on the download's state, and is
 *  answered once, by `newTerminalLayer` (`./agentDistro.ts`). */
export function layerOnHost(
  setting: AgentDistroSetting,
): AgentLayer | undefined {
  if (!setting.enabled) return undefined;
  const bake = agentDistroBake();
  if (bake === null) return undefined;
  const profile = bake.profiles.get(bundleProfileOf(setting.profile));
  // `checkAgentDistroSetting` refuses an unknown profile at the write, and the
  // bake is fixed for the process, so this is unreachable short of a bug.
  if (profile === undefined)
    throw new Error(
      `agent-distro profile '${setting.profile}' is not in this padi's listing`,
    );
  const bundle = bundleOnHost(bake, profile);
  return bundle === undefined
    ? undefined
    : { profile: setting.profile, bundle, plugins: bake.plugins };
}

/** The one record field a layer stamps (`@kolu/agent-distro/schema`). */
interface AgentLayerFields {
  agents?: TerminalAgents;
}

/** `record` with its `agents` replaced by `layer`'s — or removed, for no
 *  layer. Re-stamped WHOLE: never keeps a previous spawn's (a woken one's). */
export function withAgentLayer<R extends AgentLayerFields>(
  record: R,
  layer: AgentLayer | undefined,
): R {
  const { agents: _agents, ...rest } = record;
  return (
    layer === undefined
      ? rest
      : { ...rest, agents: { profile: layer.profile, bundle: layer.bundle } }
  ) as R;
}

/** The layer a record was stamped with, for the spawn that reads its PATH off
 *  the record. `undefined` for an unstamped record. */
export function agentLayerOfRecord(
  record: AgentLayerFields,
): AgentLayer | undefined {
  if (record.agents === undefined) return undefined;
  const bake = agentDistroBake();
  if (bake === null)
    throw new Error(
      "a terminal record carries an agent layer, but this padi has no agent-distro bake",
    );
  return {
    profile: record.agents.profile,
    bundle: record.agents.bundle,
    plugins: bake.plugins,
  };
}
