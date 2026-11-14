/** THE WORKS MIRROR — ONE subscription to kolu-server's `works` cell, and the
 *  one place every surface reads a piece of work from.
 *
 *  Its own cell rather than a field of `conductor` because a work OUTLIVES the
 *  conversation that opened it: "New session" clears the chat and leaves every
 *  waterfall in flight exactly where it was. The mark on a dock row, the
 *  column beside the chat, the tab's number and the phone's sheet are four
 *  readers of this one frame — a second subscription would only be a second
 *  frame to disagree with.
 *
 *  The cell carries the stored record (`kolu-work`'s `Work`) plus the one
 *  thing a browser cannot read for itself: how each member terminal stands by
 *  kolu's own watch, which reads hosts no browser has opened. Everything else
 *  a card draws — the agent in a terminal, its screen, a PR's check runs — is
 *  read live from that host's own mirror, never from here. */

import { EMPTY_WORKS_VIEW, type WorksView } from "kolu-common/works";
import { membershipOf, type Membership } from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { app } from "../wire";

/** The works, mirrored once for the whole app. `EMPTY_WORKS_VIEW` before the
 *  first frame lands — which is what this end honestly knows about a record it
 *  has not heard from yet. */
export const useWorks = createSharedRoot<Accessor<WorksView>>(() => {
  // Bare `.use()`: the cell DECLARES its own `onError` policy (a toast
  // labelled `Works`) on the spec, so the use-site carries none.
  const { value } = app.cells.works.use();
  return () => value() ?? EMPTY_WORKS_VIEW;
});

/** THE MEMBERSHIP INDEX, derived once — terminal (`host/id`) to the work in
 *  progress it is an active member of.
 *
 *  Every mark reads this: the dock row, the tile title, the column. One memo
 *  in one shared root, so a dock of twenty rows does not walk the works twenty
 *  times a frame, and all three marks are the same answer by construction. */
export const useMembership = createSharedRoot<
  Accessor<ReadonlyMap<string, Membership>>
>(() => {
  const works = useWorks();
  return createMemo(() => membershipOf(works().works));
});

/** HOW A MEMBER TERMINAL STANDS, by kolu's watch — ref to the level it was
 *  last read at and when it entered it. A terminal that is absent has not been
 *  read in this process, which is a different thing from "0s ago". */
export const useSeen = createSharedRoot<
  Accessor<ReadonlyMap<string, WorksView["seen"][number]>>
>(() => {
  const works = useWorks();
  return createMemo(() => {
    const byRef = new Map<string, WorksView["seen"][number]>();
    for (const one of works().seen) byRef.set(one.terminal, one);
    return byRef;
  });
});
