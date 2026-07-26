/**
 * `@kolu/padi/urgency` — the recency-FREE urgency fold off the composed
 * `terminals` collection: how many terminals await the user, and which. Backs
 * the `padiSurface.cells.urgency` cell, which is a DERIVED member —
 * `derived.cell(($) => { finish.track(); …; return recomputeUrgency(...) })` in
 * `servePadi.ts`. The graph tracks the `terminals → urgency` edge AND the
 * finish-quiet generation (dual-edge), so urgency recomputes when either the
 * collection or the quiet timer moves.
 *
 * The fold reuses the ONE shared agent-state vocabulary
 * (`agentBucket` from `@kolu/terminal-vocab/agentProjection`) rather than a
 * hand-rolled switch over the state literals, so a new `AgentInfo["state"]`
 * forces its decision in the fenced fold, not here (see
 * `.claude/rules/dock-fleet-mirror.md`). A sleeping/parked entry carries
 * `agent: null` and contributes 0.
 *
 * **Effective finish (EF2):** `finishedIds` is not raw `waiting` — a waiting
 * agent is finished when the finish-quiet episode predicate says so
 * (`isEpisodeFinished`: first quiet-crossing sticky until leave-waiting).
 * `awaiting_user` stays ungated. The tracker + sticky live in `finishQuiet.ts`;
 * this fold stays pure over `(terminals, isEpisodeFinished)`.
 */

import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal, PadiUrgency } from "../surface.ts";

/** Fold the composed `terminals` collection into the urgency projection — the
 *  ids of terminals whose agent is awaiting the user (`awaiting_user`), and of
 *  terminals that have effectively finished (`waiting` ∧ episode-finished). Takes
 *  the collection as its argument (`$.terminals()`), so it reads exactly what
 *  the wire serves and the reactive graph tracks the dependency. Recency-free by
 *  design: nothing cross-host ever compares two hosts' clocks.
 *
 *  `isEpisodeFinished(id)` is the sticky-aware finish predicate: true once the
 *  quiet window has closed for this waiting episode (or boot-seeded). The feed
 *  must still start a window on *enter*-waiting so a fresh episode does not
 *  immediate-finish before quiet. */
export function recomputeUrgency(
  terminals: ReadonlyMap<TerminalId, PadiTerminal>,
  isEpisodeFinished: (id: TerminalId) => boolean,
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
    // carried so `useAttention` applies identical rules on every host. Waiting
    // is gated on effective quiet + sticky-per-episode (EF2); asking is not.
    const bucket = agentBucket(agent.state);
    if (bucket === "awaiting") awaitingIds.push(id);
    else if (bucket === "waiting" && isEpisodeFinished(id)) {
      finishedIds.push(id);
    }
  }
  return { awaitingIds, finishedIds };
}
