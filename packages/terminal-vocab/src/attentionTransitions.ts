/**
 * The PURE attention TRANSITION decision — given a terminal-attention frame and
 * the one before it, which terminals just started deserving attention and which
 * ended their episode.
 *
 * Sibling of `agentProjection.ts`, not part of it: that module folds a single
 * `AgentInfo['state']` into a class, this one diffs two frames of already-classified
 * id LISTS. Same vocabulary family, different arity — so they stay separate files
 * under one package.
 *
 * Graduated here from `packages/client/src/attention/attentionTransitions.ts` the
 * day padi became the second consumer: padi's supervision-edge delivery (a worker
 * settling notifies its supervisor terminal) fires on the SAME edge the browser
 * fires its sound + OS popup on. Two copies of this diff would mean a human and a
 * supervising agent could be told about different events — the exact divergence
 * the shared vocabulary exists to prevent. The client keeps everything ABOVE this
 * decision (the fire-once latch, the watched gate, the unseen-finished dot); padi
 * keeps everything above it on its own side (the parent edge, the mailbox write).
 * What graduates is only the answer to "what changed".
 *
 * The frames it diffs are padi's `urgency` cell lists — `attentionClass`'s
 * partition, where `asking` is `awaiting_user` (ungated) and `finished` is
 * `waiting` ∧ EF2 quiet (the agent-idle ∧ output-settled conjunction). So a
 * consumer of this module inherits that conjunction rather than recomputing it.
 */

import type { TerminalId } from "./schema.ts";

/** The two lists the attention transition actually diffs — deliberately NOT the
 *  whole wire `urgency` value. The decision should be described by what it
 *  compares, not by what the transport happens to carry: typing it as the wire
 *  value meant widening the cell forced array copies per frame that nothing ever
 *  read, and every future wire field would land here the same way.
 *
 *  Structural, so a caller holding a richer per-class record (the client's
 *  `Pick<HostAttentionFrame["byClass"], "asking" | "finished">`, padi's own fold
 *  of the urgency cell) satisfies it without minting an adapter object per
 *  frame.
 *
 *  The key names are `attentionClass`'s own, which this package owns. A caller
 *  whose wire dialect spells the same partition differently (padi's
 *  `awaitingIds`/`finishedIds`) adapts at ITS edge, once, in a named place —
 *  see padi's `attentionFrameOf` — never ad hoc per call site. */
export interface AttentionFrame {
  /** Terminals whose agent is blocked on a human/supervisor (`awaiting_user`). */
  readonly asking: readonly TerminalId[];
  /** Terminals whose agent ended its turn AND went quiet (EF2). */
  readonly finished: readonly TerminalId[];
}

export interface AttentionTransition {
  /** Terminals that just entered the attention class (subject to the caller's own
   *  fire-once latch) — a FRESH entry, or an ESCALATION into asking from a
   *  non-asking state (a real gate over an already-finished row). `asking` selects
   *  the "needs input" vs "finished" copy. A de-escalation asking→finished is NOT
   *  a candidate. */
  candidates: Array<{ id: TerminalId; asking: boolean }>;
  /** Terminals that left BOTH sets (their agent went back to work) — the episode
   *  boundary the caller uses to clear its fire-once latch. */
  ended: TerminalId[];
}

/** `prev === null` is the baseline — the FIRST frame a consumer sees. A discovery
 *  is definitionally not a transition, so it yields no candidates and no ends; the
 *  rule lives HERE, once, not as a "remember to check prev" guard at each caller. */
export function attentionTransitions(
  prev: AttentionFrame | null,
  cur: AttentionFrame,
): AttentionTransition {
  if (prev === null) return { candidates: [], ended: [] };

  const nextAsk = new Set(cur.asking);
  const nextFin = new Set(cur.finished);
  const prevAsk = new Set(prev.asking);
  const prevFin = new Set(prev.finished);

  // Walk the source arrays directly (the two buckets are disjoint and each id is
  // unique, so `asking` then `finished` IS the union) — no throwaway
  // spread array per frame on this ~150 ms-per-host hot path.
  const ended: TerminalId[] = [];
  for (const id of prev.asking) {
    if (!nextAsk.has(id) && !nextFin.has(id)) ended.push(id);
  }
  for (const id of prev.finished) {
    if (!nextAsk.has(id) && !nextFin.has(id)) ended.push(id);
  }

  const candidates: Array<{ id: TerminalId; asking: boolean }> = [];
  // An ASKING id is a candidate unless it was already asking — a fresh entry AND a
  // finished→asking escalation both reduce to "wasn't asking last frame" (#1177).
  for (const id of cur.asking) {
    if (!prevAsk.has(id)) candidates.push({ id, asking: true });
  }
  // A FINISHED id is a candidate only as a FRESH entry into the class — it was in
  // neither prev set. (A de-escalation asking→finished, still in class, is not.)
  for (const id of cur.finished) {
    if (!prevAsk.has(id) && !prevFin.has(id)) {
      candidates.push({ id, asking: false });
    }
  }
  return { candidates, ended };
}

/** The STATEFUL form of the decision above — the previous frame, remembered. */
export interface AttentionTransitions {
  /** Diff this frame against the one before it and advance the memory. The
   *  FIRST frame is the baseline (no candidates, no ends). */
  observe(cur: AttentionFrame): AttentionTransition;
  /** Forget the memory — a host left the pool, a daemon disposed. The next
   *  frame is a baseline again. */
  reset(): void;
}

/** Remember the previous frame so a caller only ever hands over the current one.
 *
 *  The pure function above is the decision; this is the MEMORY the decision needs,
 *  and the memory is where the sharp edge lives: the incoming lists are COPIED
 *  here, once. A caller may hand back the SAME arrays every frame (a SolidJS store
 *  that mutates in place, a re-folded urgency cell), and holding the reference
 *  would make `prev` and `cur` the same object — so no transition is ever seen and
 *  NOTHING FIRES. That rule used to live twice, as a paragraph of comment, in the
 *  client's attention core and in padi's settle-event source; a silent-failure rule
 *  enforced by two copies of a comment is one edit away from being enforced by
 *  none. It lives here now, beside the diff it protects. */
export function createAttentionTransitions(): AttentionTransitions {
  let prev: AttentionFrame | null = null;
  return {
    observe(cur) {
      const transition = attentionTransitions(prev, cur);
      prev = { asking: [...cur.asking], finished: [...cur.finished] };
      return transition;
    },
    reset() {
      prev = null;
    },
  };
}
