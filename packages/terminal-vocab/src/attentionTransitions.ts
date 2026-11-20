import type { TerminalId } from "./schema.ts";

/** The two lists the attention transition actually diffs — deliberately NOT the
 *  whole wire `urgency` value. */
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
  /** Terminals that left BOTH sets — THE episode boundary. Three ways an id lands
   *  here, and they are one fact to every consumer: the agent went back to work;
   *  the agent quit back to the shell (the terminal is still open, its last output
   *  still on screen, but there is no agent left to classify); the terminal went
   *  away. A de-escalation or escalation WITHIN the two sets is not an end. */
  ended: TerminalId[];
}

/** `prev === null` is the baseline — the FIRST frame a consumer sees. A discovery
 *  is definitionally not a transition, so it yields no candidates and no ends. */
export function attentionTransitions(
  prev: AttentionFrame | null,
  cur: AttentionFrame,
): AttentionTransition {
  if (prev === null) return { candidates: [], ended: [] };

  const nextAsk = new Set(cur.asking);
  const nextFin = new Set(cur.finished);
  const prevAsk = new Set(prev.asking);
  const prevFin = new Set(prev.finished);

  const ended: TerminalId[] = [];
  for (const id of prev.asking) {
    if (!nextAsk.has(id) && !nextFin.has(id)) ended.push(id);
  }
  for (const id of prev.finished) {
    if (!nextAsk.has(id) && !nextFin.has(id)) ended.push(id);
  }

  const candidates: Array<{ id: TerminalId; asking: boolean }> = [];
  for (const id of cur.asking) {
    if (!prevAsk.has(id)) candidates.push({ id, asking: true });
  }
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
   *  FIRST frame is the baseline (no candidates, no ends) — unless the memory
   *  was seeded, in which case it diffs against the seed. */
  observe(cur: AttentionFrame): AttentionTransition;
  /** Forget the memory — a host left the pool, a daemon disposed. The next
   *  frame is a baseline again. */
  reset(): void;
}

/** Remember the previous frame so a caller only ever hands over the current one.
 *
 *  `seed` is a previous frame the caller REMEMBERED from before it started — a
 *  browser page resuming what it last saw before a reload. Without one, the
 *  first frame is a baseline, as a discovery is not a transition. */
export function createAttentionTransitions(
  seed: AttentionFrame | null = null,
): AttentionTransitions {
  const copy = (frame: AttentionFrame): AttentionFrame => ({
    asking: [...frame.asking],
    finished: [...frame.finished],
  });
  let prev: AttentionFrame | null = seed === null ? null : copy(seed);
  return {
    observe(cur) {
      const transition = attentionTransitions(prev, cur);
      prev = copy(cur);
      return transition;
    },
    reset() {
      prev = null;
    },
  };
}
