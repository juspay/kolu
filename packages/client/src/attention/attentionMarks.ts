/** The shared per-host attention MARKS store — the ONE place kolu keeps what it
 *  knows about who needs you and what is happening, for EVERY host, and the
 *  only place any surface reads it from.
 *
 *  Each host's record is that host's whole attention frame: the class-keyed id
 *  lists padi's `urgency` cell publishes (`attentionClass`'s partition), the set
 *  kaval says is currently moving bytes, whether the host's link is up, and the
 *  engine's unseen-finished tally. Everything a surface renders is DERIVED from
 *  that frame at the read site — counts as `.length`, a terminal's class via
 *  `frameClassOf`, activity via the shared `attentionCounted` predicate — so a
 *  count can never disagree with the ids it summarises, and a host tab can never
 *  disagree with the pips in the dock beneath it.
 *
 *  Two writers, one record, no clobbering: `useAttentionFacts`' single per-host
 *  mirror root writes the frame (`byClass` + `liveIds` + `live`) and the
 *  attention engine writes `unseenFinished` — both through `writeHostMarks`,
 *  which merges onto a complete seed so no writer can mint a half-record. There
 *  is exactly ONE root that fans out over `hostKeys()`, so exactly one cleanup
 *  deletes the record: "either of two roots may do the delete" was a coherence
 *  rule maintained by two matching comments rather than by the structure. */

import {
  type HostAttentionFrame,
  hostActiveIds,
  frameClassOf,
  type TerminalAttention,
} from "./attentionFacts";
import type { AttentionClass, TerminalId } from "kolu-common/surface";
import { createStore, produce } from "solid-js/store";

export interface HostMarks extends HostAttentionFrame {
  /** Finished-but-unvisited terminals on this host — the amber count. */
  unseenFinished: number;
  /** Host link + urgency cell are up — a dead host's `asking` must not count. */
  live: boolean;
  /** Has this host's `urgency` cell delivered a frame yet? An empty frame from
   *  a host that has not spoken is NOT the same fact as a host with nothing
   *  happening, and collapsing the two would let the attention engine take
   *  silence as its baseline and then chime for every agent that was already
   *  finished when the app bound — a discovery, not a transition. */
  reported: boolean;
}

/** A host we have heard nothing about yet. Every `writeHostMarks` merges onto
 *  one of these, so a record in the store is always COMPLETE — a partial write
 *  (the engine touching `unseenFinished` before the first urgency frame lands)
 *  cannot mint a record missing its id lists. FRESH per host, never one shared
 *  object: two hosts seeded from the same literal would share its nested
 *  `byClass` node inside the store, a coupling nothing needs. */
function emptyMarks(): HostMarks {
  return {
    byClass: { asking: [], working: [], linger: [], finished: [] },
    liveIds: [],
    unseenFinished: 0,
    live: false,
    reported: false,
  };
}

/** The reading for a host with no record at all — returned, never stored.
 *
 *  Built through `emptyMarks()` rather than spread from a shared literal: a
 *  spread copies the OUTER object and leaves `byClass` pointing at the very
 *  node every other empty reading uses, so one accidental push into a
 *  "host we haven't heard from" frame would corrupt the seed for all of them.
 *  The same "fresh per host, never one shared object" discipline the store's
 *  own seed follows. */
const NO_MARKS: HostMarks = emptyMarks();

const [marks, setMarks] = createStore<Record<string, HostMarks>>({});

/** Merge (or clear, with `undefined`) a host's marks. A partial object merges
 *  onto the host's record — or onto a fresh empty one if this is its first touch —
 *  so the two writers never clobber each other's fields and never leave a
 *  half-built record behind. Clearing DELETES the key (not sets it to
 *  `undefined`), so the singleton store can't grow unbounded across host
 *  add/remove churn. */
export function writeHostMarks(
  encHost: string,
  value: Partial<HostMarks> | undefined,
): void {
  if (value === undefined) {
    setMarks(produce((m) => delete m[encHost]));
    return;
  }
  setMarks(encHost, (prev) => ({ ...(prev ?? emptyMarks()), ...value }));
}

/** The encoded keys of every host the store holds a record for — the membership
 *  the attention engine's per-host state follows, so the engine consumes the
 *  mirror rather than opening a second subscription of its own. */
export function markedHosts(): readonly string[] {
  return Object.keys(marks);
}

/** A host's whole attention frame, reactively — the value every fold below
 *  reads, and the one the attention diagnostics compare against the client's
 *  per-terminal metadata. */
export function hostFrame(encHost: string): HostMarks {
  return marks[encHost] ?? NO_MARKS;
}

/** A host's asking count as a reactive read — derived from the id list at the
 *  read site, never carried separately (the urgency cell's own law). */
export function hostAsking(encHost: string): number {
  return hostAskingIds(encHost).length;
}

/** The terminals blocked on you on a host — the violet count's jump targets. */
export function hostAskingIds(encHost: string): readonly TerminalId[] {
  return hostFrame(encHost).byClass.asking;
}

/** A host's unseen-finished count as a reactive read — the amber count fodder. */
export function hostUnseenFinished(encHost: string): number {
  return marks[encHost]?.unseenFinished ?? 0;
}

/** All of a host's attention marks as reactive accessors in one call — the
 *  triplet every surface renders (active · needs-you · unseen) — so a chip
 *  reads them from ONE place (desktop chip, narrow switcher row, mobile chip). */
export function hostMarks(encHost: string): {
  active: () => number;
  asking: () => number;
  unseenFinished: () => number;
} {
  return {
    // Counts are DERIVED from the id lists at the read site — the same
    // no-second-source law the urgency cell itself follows, so a count can
    // never disagree with the ids it summarizes. `active` is the SAME predicate
    // the pips' motion runs on (`attentionFacts`), which is why the number on a
    // host tab always matches the number of moving marks under it.
    active: () => hostActiveIds(hostFrame(encHost)).length,
    asking: () => hostAsking(encHost),
    unseenFinished: () => hostUnseenFinished(encHost),
  };
}

/** One terminal's attention facts, read off the host frame it lives on — the
 *  ONE way any surface obtains them.
 *
 *  It takes the HOST KEY the store is keyed by, and reads that one record.
 *  Both facts therefore come from ONE snapshot of ONE mirrored frame: padi
 *  computed the class, shipped the answer, and this reads the answer back. The
 *  alternative — re-deriving the class from the terminal's own metadata while
 *  the count read padi's lists — put the tab on one derivation and the pip
 *  beneath it on another, arriving on two subscriptions with independent
 *  timing, which is the disagreement the partition exists to prevent. It also
 *  required scanning every host's arrays for the id, so correctness rested on
 *  "TerminalIds never collide across hosts", a rule written nowhere and
 *  enforced by nothing, and any host's ~1 s activity tick invalidated every pip
 *  memo in the dock rather than only that host's.
 *
 *  There is deliberately no way to build a `TerminalAttention` by hand at a
 *  call site: the ⌘K palette used to fabricate one for background hosts, which
 *  is why every terminal on a host you weren't looking at read as idle there. */
export function terminalAttention(
  encHost: string,
  id: TerminalId,
): TerminalAttention {
  const frame = hostFrame(encHost);
  return {
    klass: frameClassOf(frame, id),
    live: frame.liveIds.includes(id),
  };
}

/** A terminal's attention CLASS alone, without reading the live set.
 *
 *  The dock's rank-and-paint memo needs the class and nothing else, and the
 *  separation is load-bearing rather than tidy: `liveIds` churns on kaval's
 *  ~1 s idle window, so a reader that took the whole `TerminalAttention` would
 *  re-sort and re-group every dock row every time any terminal on the host
 *  printed a line. The class moves on agent transitions, which is the cadence
 *  the row order already follows. */
export function terminalClass(encHost: string, id: TerminalId): AttentionClass {
  return frameClassOf(hostFrame(encHost), id);
}

/** The app-badge fold: Σ `asking` over LIVE hosts — read reactively inside the
 *  badge effect. A dead host's held count never inflates it. */
export function liveAskingTotal(): number {
  let count = 0;
  for (const enc of Object.keys(marks)) {
    const m = marks[enc];
    if (m?.live) count += m.byClass.asking.length;
  }
  return count;
}
