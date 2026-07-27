/** The attention FACTS a surface needs about one terminal, and the host-level
 *  fold of the same question — kept in one file, pure, because the whole point
 *  is that they are the same question asked at two altitudes.
 *
 *  A terminal's attention state is exactly two things: which `attentionClass`
 *  padi's partition puts it in, and whether bytes are moving in it. Every
 *  surface decision downstream — does the pip move, is this terminal counted on
 *  its host's tab, does its repo section header light up — is a function of that
 *  pair via `attentionActive`. Passing the pair around as ONE value (rather than
 *  as a handful of loose booleans a caller assembles per site) is what makes the
 *  old family of bugs unspellable: a call site cannot fabricate
 *  `{isLive:false,isFinished:false}` for a host it hasn't got facts for, because
 *  there is no such shape to fabricate.
 *
 *  Two altitudes, one predicate:
 *    • per terminal — `attentionActive(a.klass, a.live)` decides the pip's
 *      motion (`statePipBind`);
 *    • per host — `hostActiveIds` folds that host's mirrored urgency frame into
 *      the ids the tab counts.
 *  `attentionFacts.test.ts` pins that the second agrees with the first for every
 *  class × live combination, so the tab count and the moving pips can never
 *  disagree about what "active" means. That disagreement — a tab reading 2 next
 *  to three moving pips — is the defect this module exists to make impossible. */

import {
  type AttentionClass,
  attentionActive,
  type TerminalId,
} from "kolu-common/surface";

/** One terminal's attention facts. `klass` is padi's partition (which urgency
 *  list it is in); `live` is kaval's raw byte-motion edge. */
export interface TerminalAttention {
  readonly klass: AttentionClass;
  readonly live: boolean;
}

/** The attention facts for a terminal nothing has told us about yet — a host
 *  whose urgency cell has not landed, or a terminal with no agent and no
 *  output. Honest emptiness, not a fabricated "nothing is happening": every
 *  field is genuinely unknown-or-absent, and the moment a frame arrives the
 *  real value replaces it wholesale. */
export const NO_ATTENTION: TerminalAttention = { klass: "idle", live: false };

/** A host's mirrored urgency frame plus its live set — the four disjoint
 *  class lists padi published and the ids kaval says are moving bytes. */
export interface HostAttentionFrame {
  readonly askingIds: readonly TerminalId[];
  readonly workingIds: readonly TerminalId[];
  readonly lingerIds: readonly TerminalId[];
  readonly finishedIds: readonly TerminalId[];
  readonly liveIds: readonly TerminalId[];
}

/** The terminals on a host that are ACTIVE but not blocked on you — what the
 *  host tab's rust count counts, and the dock section header's.
 *
 *  Derived rather than counted per terminal because a background host's
 *  terminals are not mirrored at all: its tab knows only these id lists. The
 *  union is exactly `attentionActive`'s membership — `working` and `linger` are
 *  active unconditionally, `finished` and `idle` only while live — with the
 *  asking ids removed because they have their own violet count and must not be
 *  counted twice. `lingerIds` is why a just-finished agent still settling shows
 *  up here: its pip is still moving, so its host says so too.
 *
 *  Ids, not a number, so the count is `.length` at the read site — the urgency
 *  cell's own no-second-source law, all the way to the pixel. */
export function hostActiveIds(
  frame: HostAttentionFrame,
): readonly TerminalId[] {
  const asking = new Set(frame.askingIds);
  const out: TerminalId[] = [];
  const seen = new Set<TerminalId>();
  for (const id of [
    ...frame.workingIds,
    ...frame.lingerIds,
    ...frame.liveIds,
  ]) {
    // `liveIds` overlaps the class lists freely (a thinking agent usually IS
    // printing), so this union — unlike the class lists among themselves —
    // genuinely needs the de-dup.
    if (asking.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Which class list holds this id, if any — the per-terminal read of the same
 *  frame `hostActiveIds` folds. `undefined` means the frame does not mention it
 *  (no agent, or a host that hasn't reported), which is `idle`. */
export function frameClassOf(
  frame: HostAttentionFrame,
  id: TerminalId,
): AttentionClass {
  if (frame.askingIds.includes(id)) return "asking";
  if (frame.workingIds.includes(id)) return "working";
  if (frame.lingerIds.includes(id)) return "linger";
  if (frame.finishedIds.includes(id)) return "finished";
  return "idle";
}

/** Is this terminal active? Re-exported at the value level so a surface reads
 *  the predicate off the value it already holds rather than unpacking it. */
export function isActive(a: TerminalAttention): boolean {
  return attentionActive(a.klass, a.live);
}
