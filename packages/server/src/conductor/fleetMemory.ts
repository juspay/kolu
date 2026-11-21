/**
 * THE CONDUCTOR'S MEMORY, as the fleet face's `memory` resource serves it:
 * the approved entries, the titles of the proposals still waiting, and the
 * room. A proposal is never an entry here.
 */

import {
  MEMORY_CAP,
  type Memory,
  memoryUsed,
  proposalTitle,
} from "kolu-common/conductorMemory";
import type { FleetMemoryView } from "kolu-mcp";

export const fleetMemoryView = (memory: Memory): FleetMemoryView => ({
  entries: memory.entries.map(({ id, title, about, body }) => ({
    id,
    title,
    about,
    body,
  })),
  waiting: memory.proposals.map((proposal) => ({
    id: proposal.id,
    title: proposalTitle(memory, proposal),
  })),
  room: { used: memoryUsed(memory.entries), of: MEMORY_CAP },
});
