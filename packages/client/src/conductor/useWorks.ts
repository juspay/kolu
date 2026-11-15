/** THE WORKS MIRROR — ONE subscription to kolu-server's `works` collection,
 *  one to the `workMembers` map beside it, and the one place every surface
 *  reads a piece of work from.
 *
 *  Their own members rather than a field of `conductor` because a work
 *  OUTLIVES the conversation that opened it: "New session" clears the chat and
 *  leaves every waterfall in flight exactly where it was. The mark on a dock
 *  row, the column beside the chat, the tab's number and the phone's sheet are
 *  four readers of this one frame — a second subscription would only be a
 *  second frame to disagree with.
 *
 *  A WORK IS ITS KEY. The collection is keyed by the work's id (the canonical
 *  encoding of host/repo/branch, or of the terminal a watch is about), so one
 *  branch has one card BY CONSTRUCTION: there is no way for a second
 *  `work_open` to arrive as a second entry. The record itself carries no id —
 *  the key is the id — which is why every reader here passes the two together.
 *
 *  MEMBERSHIP IS ITS OWN MAP, keyed by terminal ref: a terminal is in at most
 *  one piece of work because there is one slot for it. A member of a work that
 *  has ENDED cannot be written down at all — ending removes its members in the
 *  same step — so a finished card has nothing to draw terminals from.
 *
 *  `memberReadings` carries the one thing a browser cannot read for itself: how
 *  each member terminal stands by kolu's own watch, which reads hosts no
 *  browser has opened. Everything else a card draws — the agent in a terminal,
 *  its screen, a PR's check runs — is read live from that host's own mirror,
 *  never from here. */

import type { MemberReading } from "kolu-common/works";
import {
  finished,
  inProgress,
  membershipOf,
  type Membership,
  type Work,
  type WorkId,
  type WorkMember,
  type WorkRow,
} from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";

/** THE WORKS BY ID, mirrored once for the whole app — the shape membership is
 *  folded from, and what a reader looking for ONE work (the reader window, a
 *  chat row's question) asks. */
export const useWorkMap = createSharedRoot<Accessor<ReadonlyMap<WorkId, Work>>>(
  () => {
    // Bare `.use()`: the collection DECLARES its own `onError` policy (a toast
    // labelled `Works`) on the spec, so the use-site carries none, and its
    // default keys stream is the server's own — every work, no narrowing.
    const works = app.collections.works.use();
    return createMemo(() => {
      const by = new Map<WorkId, Work>();
      for (const id of works.keys()) {
        const one = works.byKey(id)?.();
        if (one !== undefined) by.set(id, one);
      }
      return by;
    });
  },
);

/** THE WORKS, in the order every reader draws them: in progress oldest first
 *  (a card keeps its place), then the finished ones most recently ended first.
 *
 *  The keys arrive as a SET — arrival order is not a fact about the works — so
 *  the records are sorted by when they started before `inProgress` filters
 *  them, which is what makes "oldest first" true of a browser that joined
 *  mid-run as well as of one that was there from the start. */
export const useWorks = createSharedRoot<Accessor<ReadonlyArray<WorkRow>>>(
  () => {
    const map = useWorkMap();
    return createMemo(() => {
      const pairs = [...map()].sort(([, a], [, b]) =>
        a.startedAt < b.startedAt ? -1 : 1,
      );
      return [...inProgress(pairs), ...finished(pairs)];
    });
  },
);

/** EVERY TERMINAL THAT IS IN A PIECE OF WORK, by its `<host>/<id>` ref — the
 *  one map, mirrored once. A ref that is not a key here is in no work; a ref
 *  that is names exactly one. */
export const useWorkMembers = createSharedRoot<
  Accessor<ReadonlyMap<string, WorkMember>>
>(() => {
  const members = app.collections.workMembers.use();
  return createMemo(() => {
    const by = new Map<string, WorkMember>();
    for (const ref of members.keys()) {
      const one = members.byKey(ref)?.();
      if (one !== undefined) by.set(ref, one);
    }
    return by;
  });
});

/** THE MEMBERSHIP INDEX, derived once — terminal (`host/id`) to the work it is
 *  a member of, and WHO DRIVES it.
 *
 *  Every mark and every person-input site reads this: the dock row, the tile
 *  title, the column, the lock. One memo in one shared root, so a dock of
 *  twenty rows does not walk the works twenty times a frame, and the mark, the
 *  banner and the keystroke gate are the same answer by construction. */
export const useMembership = createSharedRoot<
  Accessor<ReadonlyMap<string, Membership>>
>(() => {
  const works = useWorkMap();
  const members = useWorkMembers();
  return createMemo(() => membershipOf(works(), members()));
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
