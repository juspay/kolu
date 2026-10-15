/**
 * What a terminal gets from agent-distro, and how its record remembers it — the
 * spawn-time facts. A layer is the EXACT package store path whose `bin/` goes
 * on PATH, the exact built profiles exported as `AI_PROFILE` (the terminal pins
 * them: a later update or a change of the list never touches a running
 * terminal), and the plugin dir. The record carries the package and profiles
 * (`agents`, the tile pill); the spawn reads its env back off the record, so
 * the chip and the env are one value.
 */

import type { DeliveredProfile } from "@kolu/agent-distro/landing";
import type { TerminalAgents } from "@kolu/agent-distro/schema";
import { agentDistroBake } from "./bake.ts";

/** What a new terminal gets: the package (whose `bin/` goes on PATH), the
 *  built profiles (`AI_PROFILE`, in stack order), and the plugin dir
 *  (`AGENT_DISTRO_PLUGINS`). */
export interface AgentLayer {
  readonly bundle: string;
  readonly profiles: readonly DeliveredProfile[];
  readonly plugins: string;
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
      : {
          ...rest,
          agents: { bundle: layer.bundle, profiles: [...layer.profiles] },
        }
  ) as R;
}

/** The layer a record was stamped with, for the spawn that reads its env off
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
    bundle: record.agents.bundle,
    profiles: record.agents.profiles,
    plugins: bake.plugins,
  };
}
