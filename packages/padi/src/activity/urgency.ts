/**
 * `@kolu/padi/urgency` — the recency-FREE urgency fold off the composed
 * `terminals` collection: which terminals await the user, which just finished,
 * which are working, and which are still lingering after their turn (the
 * host-tab attention summary reads all four — its ACTIVITY count is
 * working + linger, matching what the pip's motion channel shows). Backs
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

import { attentionClass } from "@kolu/terminal-vocab/agentProjection";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PadiTerminal, PadiUrgency } from "../surface.ts";

/** Fold the composed `terminals` collection into the urgency projection — one
 *  id-list per `attentionClass` (asking · working · linger · finished), the
 *  classes being a partition, so the lists are disjoint and a consumer adds
 *  them without de-duplicating. Takes
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
  const workingIds: TerminalId[] = [];
  const lingerIds: TerminalId[] = [];
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
    // The ONE shared partition (`attentionClass`) decides which list an id
    // lands in — the same function the client folds a terminal's own metadata
    // through to decide that terminal's pip, so a wire list and a pip can't
    // mean different things. Every terminal lands in exactly one list (or
    // none), which is what lets a consumer add the lists without de-duplicating.
    // A waiting agent splits on effective quiet + sticky-per-episode (EF2):
    // still lingering until it closes, finished after. Asking is ungated.
    switch (attentionClass(terminal.agent, isEpisodeFinished(id))) {
      case "asking":
        awaitingIds.push(id);
        break;
      case "working":
        workingIds.push(id);
        break;
      case "linger":
        lingerIds.push(id);
        break;
      case "finished":
        finishedIds.push(id);
        break;
      case "idle":
        break;
    }
  }
  return { awaitingIds, finishedIds, workingIds, lingerIds };
}
