/** The context meter's line about where the conversation is compacted — the
 *  choice the running agent was started with, said in the agent's own name. */

import {
  CONDUCTOR_MODEL_LIMIT,
  type ConductorCompactsAt,
} from "kolu-common/conductor";
import { tokens } from "./tokens";

export function compactsTip(
  agentName: string,
  compactsAt: ConductorCompactsAt,
): string {
  return compactsAt === CONDUCTOR_MODEL_LIMIT
    ? `Your ${agentName} settings decide when it is compacted.`
    : `${agentName} compacts it at about ${tokens(compactsAt)}.`;
}
