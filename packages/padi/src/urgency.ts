/**
 * `@kolu/padi/urgency` — the recency-FREE urgency fold off the composed
 * `terminals` collection: how many terminals await the user, and which. Backs
 * the `padiSurface.cells.urgency` cell, which is now a DERIVED member —
 * `derived.cell(($) => recomputeUrgency($.terminals()))` in `servePadi.ts`. The
 * graph tracks the `terminals → urgency` edge, so a registry writer can no
 * longer forget to refold urgency: it recomputes exactly when the collection it
 * reads changes.
 *
 * The fold reuses the ONE shared agent-state vocabulary
 * (`agentBucket` from `@kolu/terminal-vocab/agentProjection`) rather than a
 * hand-rolled switch over the state literals, so a new `AgentInfo["state"]`
 * forces its decision in the fenced fold, not here (see
 * `.claude/rules/dock-fleet-mirror.md`). A sleeping/parked entry carries
 * `agent: null` and contributes 0.
 */

import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal, PadiUrgency } from "./surface.ts";

/** Fold the composed `terminals` collection into the urgency projection — the
 *  ids (and count) of terminals whose agent is awaiting the user
 *  (`awaiting_user`), in the map's insertion order. Takes the collection as its
 *  argument (`$.terminals()`), so it reads exactly what the wire serves and the
 *  reactive graph tracks the dependency. Recency-free by design: nothing
 *  cross-host ever compares two hosts' clocks. */
export function recomputeUrgency(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
): PadiUrgency {
  const awaitingIds: TerminalId[] = [];
  for (const [id, terminal] of terminals) {
    // Only LIVE (active) terminals can await the user. Gating on the composed
    // record's `active` discriminant is the collection-side twin of the old
    // registry gate on `entry.meta.state === "active"`: a sleeping/parked entry
    // is a DIFFERENT arm of the `PadiTerminal` union (no live `agent`), so
    // narrowing to `active` here excludes a terminal slept mid-`awaiting_user`
    // exactly as before — the old fold read the frozen registry snapshot and had
    // to gate on the authored state; the composed union makes the same fact the
    // discriminant.
    if (terminal.state !== "active") continue;
    const agent = terminal.agent;
    if (agent && agentBucket(agent.state) === "awaiting") awaitingIds.push(id);
  }
  return { awaitingIds };
}
