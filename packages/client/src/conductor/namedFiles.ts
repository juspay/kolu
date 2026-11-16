/** WHICH WORK'S FILE A NAMED PATH OPENS — read off the record kolu already
 *  keeps and the chat turn the sentence is in, never off the sentence.
 *
 *  The Conductor writes "its plan is at `.waterfall/plan.md`". kolu knows
 *  every file of every work it holds: a work in progress lists the files it
 *  has seen appear (its `file` events, `filesSeen`), and a work that ended
 *  lists the copies it kept (`keptOf`), which are what the reader can still
 *  open. So a code span whose text is EXACTLY one of those paths names a file
 *  — and nothing else does.
 *
 *  Every work has a `.waterfall/plan.md`, so WHICH one is read off the turn
 *  the sentence is in (`./turnWorks.ts`): a turn about one work opens that
 *  work's file, and says so when that work has no such file yet rather than
 *  offering another work's; a turn about several offers only those of them
 *  that hold it; a turn about none offers every work that does. No heuristic
 *  picks among several: the person does (`ConductorProse`).
 *
 *  Derived, never stored: the works collection is live, so a file that
 *  appears after the sentence turns the sentence's mention into a link by
 *  itself, and a restart reads the same. */

import { Option } from "effect";
import { filesSeen, keptOf, type Work, type WorkId } from "kolu-work";

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

/** WHAT PRESSING A NAMED PATH DOES, as a sum:
 *
 *  - `plain` — no work holds it: it is code, not a link;
 *  - `open` — one work's file, opened at once;
 *  - `missing` — the turn's works hold no such file yet: say so, in place;
 *  - `choose` — several works hold it: the person picks one. */
export type FileTarget =
  | { readonly kind: "plain" }
  | { readonly kind: "open"; readonly work: WorkId }
  | { readonly kind: "missing"; readonly works: ReadonlyArray<WorkId> }
  | { readonly kind: "choose"; readonly works: ReadonlyArray<WorkId> };

/** THE ONE RULE: which work's `path` a mention in a turn about `turn` opens. */
export function fileTarget(
  works: ReadonlyMap<WorkId, Work>,
  turn: ReadonlyArray<WorkId>,
  path: string,
): FileTarget {
  const holding = (ids: Iterable<WorkId>): ReadonlyArray<WorkId> =>
    [...ids].filter((id) => {
      const one = works.get(id);
      return one !== undefined && holdsPath(one, path);
    });
  const anywhere = holding(works.keys());
  if (anywhere.length === 0) return { kind: "plain" };
  const holders = turn.length === 0 ? anywhere : holding(turn);
  const [only, ...more] = holders;
  if (only === undefined) return { kind: "missing", works: turn };
  if (more.length === 0) return { kind: "open", work: only };
  return { kind: "choose", works: holders };
}
