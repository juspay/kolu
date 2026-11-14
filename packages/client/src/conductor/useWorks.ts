/** THE WORKS MIRROR — ONE subscription to kolu-server's `works` collection,
 *  and the one place every surface reads a piece of work from.
 *
 *  Their own members rather than a field of `conductor` because a work
 *  OUTLIVES the conversation that opened it: "New session" clears the chat and
 *  leaves every waterfall in flight exactly where it was. The mark on a dock
 *  row, the column beside the chat, the tab's number and the phone's sheet are
 *  four readers of this one frame — a second subscription would only be a
 *  second frame to disagree with.
 *
 *  COLLECTIONS, keyed: a work that moved sends itself, and a member's level
 *  moving sends that reading. The old single `works` cell re-sent every work
 *  (the twenty finished ones included) on every agent-state event — which is
 *  tens of thousands of whole-list frames a day from one agent that stops every
 *  minute. The ORDER the column draws is therefore derived HERE, from the
 *  records themselves (`inProgress` / `finished`), never from the order keys
 *  happened to arrive in.
 *
 *  `memberReadings` carries the one thing a browser cannot read for itself: how
 *  each member terminal stands by kolu's own watch, which reads hosts no
 *  browser has opened. Everything else a card draws — the agent in a terminal,
 *  its screen, a PR's check runs — is read live from that host's own mirror,
 *  never from here. */

import type { MemberReading } from "kolu-common/works";
import { finished, inProgress, membershipOf, type Membership } from "kolu-work";
import type { Work } from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";

/** THE WORKS, mirrored once for the whole app, in the order every reader
 *  draws them: in progress oldest first (a card keeps its place), then the
 *  finished ones most recently ended first.
 *
 *  The keys arrive as a SET — arrival order is not a fact about the works — so
 *  the records are sorted by when they started before `inProgress` filters
 *  them, which is what makes "oldest first" true of a browser that joined
 *  mid-run as well as of one that was there from the start. */
export const useWorks = createSharedRoot<Accessor<ReadonlyArray<Work>>>(() => {
  // Bare `.use()`: the collection DECLARES its own `onError` policy (a toast
  // labelled `Works`) on the spec, so the use-site carries none, and its
  // default keys stream is the server's own — every work, no narrowing.
  const works = app.collections.works.use();
  return createMemo(() => {
    const records: Work[] = [];
    for (const id of works.keys()) {
      const one = works.byKey(id)?.();
      if (one !== undefined) records.push(one);
    }
    records.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
    return [...inProgress(records), ...finished(records)];
  });
});

/** THE MEMBERSHIP INDEX, derived once — terminal (`host/id`) to the work in
 *  progress it is an active member of, and WHO DRIVES it.
 *
 *  Every mark and every person-input site reads this: the dock row, the tile
 *  title, the column, the lock. One memo in one shared root, so a dock of
 *  twenty rows does not walk the works twenty times a frame, and the mark, the
 *  banner and the keystroke gate are the same answer by construction. */
export const useMembership = createSharedRoot<
  Accessor<ReadonlyMap<string, Membership>>
>(() => {
  const works = useWorks();
  return createMemo(() => membershipOf(works()));
});

/** HOW A MEMBER TERMINAL STANDS, by kolu's watch — ref to the level it was
 *  last read at and when it entered it. A terminal that is absent has not been
 *  read in this process, which is a different thing from "0s ago". */
export const useSeen = createSharedRoot<
  Accessor<ReadonlyMap<string, MemberReading>>
>(() => {
  const readings = app.collections.memberReadings.use();
  return createMemo(() => {
    const byRef = new Map<string, MemberReading>();
    for (const ref of readings.keys()) {
      const one = readings.byKey(ref)?.();
      if (one !== undefined) byRef.set(ref, one);
    }
    return byRef;
  });
});
