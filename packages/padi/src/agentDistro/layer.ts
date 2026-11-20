import type { DeliveredProfile } from "@kolu/agent-distro/landing";
import type { TerminalAgents } from "@kolu/agent-distro/schema";
import { agentDistroBake } from "./bake.ts";

export interface AgentLayer {
  readonly bundle: string;
  readonly profiles: readonly DeliveredProfile[];
  readonly plugins: string;
}

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
