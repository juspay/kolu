/** The shared per-host attention MARKS store — the ONE place kolu keeps what it
 *  knows about who needs you and what is happening, for EVERY host, and the
 *  only place any surface reads it from.
 *
 *  Each host's record is that host's whole attention frame: the four disjoint
 *  class lists padi's `urgency` cell publishes (`attentionClass`'s partition),
 *  the set kaval says is currently moving bytes, whether the host's link is up,
 *  and the engine's unseen-finished tally. Everything a surface renders is
 *  DERIVED from that frame at the read site — counts as `.length`, activity via
 *  the shared `attentionActive` predicate — so a count can never disagree with
 *  the ids it summarises, and a host tab can never disagree with the pips in the
 *  dock beneath it.
 *
 *  Three writers, one record, no clobbering: `useAttention`'s per-host root
 *  writes the urgency lists + `live`, `useAttentionFacts` writes `liveIds`, and
 *  the attention engine writes `unseenFinished` — each through `writeHostMarks`,
 *  which merges onto a complete seed so no writer can mint a half-record. All
 *  three fan out over the same `hostKeys()` membership, so a host's roots are
 *  disposed together and either cleanup may delete the record. */

import {
  type HostAttentionFrame,
  hostActiveIds,
  type TerminalAttention,
} from "./attentionFacts";
import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import { attentionClass, type TerminalId } from "kolu-common/surface";
import { createStore, produce } from "solid-js/store";

export interface HostMarks extends HostAttentionFrame {
  /** Terminals blocked on your input — the violet needs-you count (`.length`)
   *  and the count click's jump targets. */
  askingIds: readonly TerminalId[];
  /** Agents in flight (thinking / tools / background). */
  workingIds: readonly TerminalId[];
  /** Agents whose turn ended but whose output is still landing (pre-EF2) —
   *  counted as activity, because their pips are still moving. */
  lingerIds: readonly TerminalId[];
  /** Terminals that effectively finished a turn (EF2). Not itself a rendered
   *  mark — the amber count is `unseenFinished` — but held so the host's whole
   *  urgency frame lives in ONE place, which the pips read for their own
   *  finish state and the diagnostics read to compare padi's view against the
   *  client's per-terminal metadata. */
  finishedIds: readonly TerminalId[];
  /** Terminals moving bytes right now (kaval's meaningful-output edge, folded
   *  through padi's short idle window). The evidence of activity for anything
   *  with no agent to ask — a plain shell running a build — and what keeps a
   *  finished agent counted while its last output prints. */
  liveIds: readonly TerminalId[];
  /** Finished-but-unvisited terminals on this host — the amber count. */
  unseenFinished: number;
  /** Host link + urgency cell are up — a dead host's `asking` must not count. */
  live: boolean;
}

/** A host we have heard nothing about yet. Every `writeHostMarks` merges onto
 *  this, so a record in the store is always COMPLETE — a partial write (the
 *  engine touching `unseenFinished` before the first urgency frame lands)
 *  cannot mint a record missing its id lists. */
const EMPTY_MARKS: HostMarks = {
  askingIds: [],
  workingIds: [],
  lingerIds: [],
  finishedIds: [],
  liveIds: [],
  unseenFinished: 0,
  live: false,
};

const [marks, setMarks] = createStore<Record<string, HostMarks>>({});

/** Merge (or clear, with `undefined`) a host's marks. A partial object merges
 *  onto the host's record — or onto `EMPTY_MARKS` if this is its first touch —
 *  so the three writers never clobber each other's fields and never leave a
 *  half-built record behind. Clearing DELETES the key (not sets it to
 *  `undefined`), so the singleton store can't grow unbounded across host
 *  add/remove churn; it is idempotent, so whichever of a host's roots disposes
 *  first may do it. */
export function writeHostMarks(
  encHost: string,
  value: Partial<HostMarks> | undefined,
): void {
  if (value === undefined) {
    setMarks(produce((m) => delete m[encHost]));
    return;
  }
  setMarks(encHost, (prev) => ({ ...(prev ?? EMPTY_MARKS), ...value }));
}

/** A host's whole attention frame, reactively — the value every fold below
 *  reads, and the one the attention diagnostics compare against the client's
 *  per-terminal metadata. */
export function hostFrame(encHost: string): HostMarks {
  return marks[encHost] ?? EMPTY_MARKS;
}

/** A host's asking count as a reactive read — derived from the id list at the
 *  read site, never carried separately (the urgency cell's own law). */
export function hostAsking(encHost: string): number {
  return marks[encHost]?.askingIds.length ?? 0;
}

/** The terminals blocked on you on a host — the violet count's jump targets. */
export function hostAskingIds(encHost: string): readonly TerminalId[] {
  return marks[encHost]?.askingIds ?? [];
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

/** Is this terminal moving bytes right now? Reads the mirrored live sets, so it
 *  answers for a terminal on ANY host, not just the one you are looking at. */
export function terminalIsLive(id: TerminalId): boolean {
  for (const enc of Object.keys(marks)) {
    if (marks[enc]?.liveIds.includes(id)) return true;
  }
  return false;
}

/** Has this terminal's turn gone effectively quiet (padi's EF2)? Same
 *  cross-host read as `terminalIsLive`. */
export function terminalIsFinished(id: TerminalId): boolean {
  for (const enc of Object.keys(marks)) {
    if (marks[enc]?.finishedIds.includes(id)) return true;
  }
  return false;
}

/** One terminal's attention facts, from its own metadata plus the mirrored
 *  frames — the ONE way any surface obtains them.
 *
 *  It takes the metadata a surface already holds rather than a host key,
 *  because that is what every call site has and because the class must be read
 *  from the SAME snapshot the pip paints from: deriving the colour from the
 *  agent state and the motion from a separately-arriving id list is how a pip
 *  ends up painted busy while standing still. The EF2 finish verdict is the one
 *  fact metadata cannot carry (it is padi's sticky quiet timer), so it comes
 *  from the mirror.
 *
 *  There is deliberately no way to build a `TerminalAttention` by hand at a
 *  call site: the ⌘K palette used to fabricate one for background hosts, which
 *  is why every terminal on a host you weren't looking at read as idle there. */
export function terminalAttention(
  meta: TerminalMetadata,
  id: TerminalId,
): TerminalAttention {
  return {
    klass: attentionClass(activeArm(meta)?.agent, terminalIsFinished(id)),
    live: terminalIsLive(id),
  };
}

/** The app-badge fold: Σ `asking` over LIVE hosts — read reactively inside the
 *  badge effect. A dead host's held count never inflates it. */
export function liveAskingTotal(): number {
  let count = 0;
  for (const enc of Object.keys(marks)) {
    const m = marks[enc];
    if (m?.live) count += m.askingIds.length;
  }
  return count;
}
