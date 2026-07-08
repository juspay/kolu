/**
 * `@kolu/padi/urgency` — the recency-FREE urgency fold off the terminal
 * registry: how many terminals await the user, and which. Backs the
 * `padiSurface.cells.urgency` cell.
 *
 * The fold reuses the ONE shared agent-state vocabulary
 * (`agentBucket` from `@kolu/terminal-workspace/agentProjection`) rather than a
 * hand-rolled switch over the state literals, so a new `AgentInfo["state"]`
 * forces its decision in the fenced fold, not here (see
 * `.claude/rules/dock-fleet-mirror.md`). A sleeping/parked entry carries
 * `agent: null` and contributes 0.
 */

import { agentBucket } from "@kolu/terminal-workspace/agentProjection";
import type { TerminalId } from "@kolu/terminal-workspace/schema";
import type { PadiUrgency } from "./surface.ts";
import { terminalEntries } from "./terminal-registry.ts";

/** Fold the registry into the urgency projection — the ids (and count) of
 *  terminals whose agent is awaiting the user (`awaiting_user`), in canonical
 *  `Map` insertion order. Recency-free by design: nothing cross-host ever
 *  compares two hosts' clocks. */
export function recomputeUrgency(): PadiUrgency {
  const awaitingIds: TerminalId[] = [];
  for (const [id, entry] of terminalEntries()) {
    // Only LIVE (active) terminals can await the user. A sleeping/parked entry
    // keeps its `snapshot` frozen whole through `beginSleep` (the agent is NOT
    // nulled until the cold-boot restore path), so reading the raw registry
    // snapshot here would count a terminal slept mid-`awaiting_user` as still
    // awaiting — inflating the badge and deep-linking a dormant tile. Gate on
    // the authored state, exactly as the sibling `countActiveClaudeSessions`
    // does, rather than the frozen snapshot the compose boundary strips.
    if (entry.meta.state !== "active") continue;
    const agent = entry.snapshot.agent;
    if (agent && agentBucket(agent.state) === "awaiting") awaitingIds.push(id);
  }
  return { awaitingIds };
}

/** Two urgency readings are equal when they carry the same awaiting ids in the
 *  same order — the cell's `equals`, so the ~150 ms agent firehose (R1's
 *  write-triggers) can't re-publish an unchanged projection. The count is
 *  derived (`awaitingIds.length`), so comparing ids alone is already complete. */
export function urgencyEqual(a: PadiUrgency, b: PadiUrgency): boolean {
  if (a.awaitingIds.length !== b.awaitingIds.length) return false;
  for (let i = 0; i < a.awaitingIds.length; i++) {
    if (a.awaitingIds[i] !== b.awaitingIds[i]) return false;
  }
  return true;
}
