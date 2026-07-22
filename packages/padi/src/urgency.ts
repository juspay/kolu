/**
 * `@kolu/padi/urgency` — the recency-FREE urgency fold off the composed
 * `terminals` collection: how many terminals await the user, and which. Backs
 * the `padiSurface.cells.urgency` cell, which is now a DERIVED member —
 * `derived.cell(($) => recomputeUrgency($.terminals(), finishGate.settledFinished()))`
 * in `servePadi.ts`. The graph tracks BOTH edges — `terminals → urgency` (a
 * registry writer can no longer forget to refold urgency; it recomputes exactly
 * when the collection it reads changes) AND `finishGate.settledFinished() →
 * urgency` (a `waiting` terminal crossing the quiet threshold re-folds the badge,
 * see `finishGate.ts`).
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
 *  cross-host ever compares two hosts' clocks.
 *
 *  `settledFinished` is the EFFECTIVE-finish gate (see `finishGate.ts`): the set
 *  of `waiting` terminals whose PTY has actually gone quiet for the debounce
 *  window. An agent (Claude Code is the motivating case) can mark its turn
 *  `waiting` while background sub-agents keep emitting bytes, so raw `waiting` is
 *  a premature "finished". A `waiting` terminal enters `finishedIds` only once
 *  the gate has confirmed it quiet — DEFAULT-EXCLUDED, so a terminal that just
 *  flipped to `waiting` (and isn't yet in the set) is held back rather than
 *  firing early. The ASKING path is UNGATED: `awaiting_user` is blocking and
 *  actionable, so it fires at once regardless of output. */
export function recomputeUrgency(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  settledFinished: ReadonlySet<TerminalId>,
): PadiUrgency {
  const awaitingIds: TerminalId[] = [];
  const finishedIds: TerminalId[] = [];
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
    if (!agent) continue;
    // The two attention buckets, read through the ONE shared fence: `awaiting`
    // (blocked on you now) and `waiting` (just finished its turn). Both are
    // carried so `useAttention` applies identical rules on every host.
    const bucket = agentBucket(agent.state);
    if (bucket === "awaiting") awaitingIds.push(id);
    // `waiting` is only an EFFECTIVE finish once the gate confirms PTY quiet —
    // a terminal still moving bytes (background sub-agents) is deliberately held
    // out of `finishedIds` until it settles.
    else if (bucket === "waiting" && settledFinished.has(id))
      finishedIds.push(id);
  }
  return { awaitingIds, finishedIds };
}
