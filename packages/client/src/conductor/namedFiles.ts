/** WHICH WORKS HOLD A FILE THE CONDUCTOR NAMES — read off the record kolu
 *  already keeps, never off the sentence.
 *
 *  The Conductor writes "its plan is at `.waterfall/plan.md`". kolu knows
 *  every file of every work it holds: a work in progress lists the files it
 *  has seen appear (its `file` events, `filesSeen`), and a work that ended
 *  lists the copies it kept (`keptOf`), which are what the reader can still
 *  open. So a code span whose text is EXACTLY one of those paths names a file
 *  of those works — and nothing else does. No heuristic picks among several:
 *  the person does (`ConductorProse`).
 *
 *  Derived, never stored: the works collection is live, so a file that
 *  appears after the sentence turns the sentence's mention into a link by
 *  itself, and a restart reads the same. */

import { Option } from "effect";
import { filesSeen, keptOf, type Work, type WorkId } from "kolu-work";

/** One work that holds a named file — what a choice between several shows. */
export interface FileHolder {
  readonly work: WorkId;
  readonly title: string;
}

/** The paths a work holds: its kept copies once it has ended, the files it
 *  has seen appear while it is in progress. */
const pathsOf = (work: Work): ReadonlySet<string> =>
  Option.match(keptOf(work), {
    onNone: () => filesSeen(work),
    onSome: (kept) => new Set(kept.map((one) => one.path)),
  });

/** WHETHER THE READER CAN OPEN `path` OF `work` — what makes a mention in the
 *  chat, or a `Wrote …` row on the card's timeline, a link: always while the
 *  work is in progress (it saw the file appear), and for a work that has
 *  ended only when kolu kept a copy, since its worktree may be gone. */
export const holdsPath = (work: Work, path: string): boolean =>
  pathsOf(work).has(path);

/** Every work holding exactly `path`, in the collection's order. */
export const worksHolding = (
  works: ReadonlyMap<WorkId, Work>,
  path: string,
): ReadonlyArray<FileHolder> =>
  [...works].flatMap(([work, one]) =>
    holdsPath(one, path) ? [{ work, title: one.title }] : [],
  );
