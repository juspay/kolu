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
import { type NonEmpty, nonEmpty } from "nonempty";

/** THE PATHS A WORK HOLDS: its kept copies once it has ended, the files it
 *  has seen appear while it is in progress — one work's own reading, so a
 *  mirror of many works is read work by work. */
export const pathsOf = (work: Work): ReadonlySet<string> =>
  Option.match(keptOf(work), {
    onNone: () => filesSeen(work),
    onSome: (kept) => new Set(kept.map((one) => one.path)),
  });

/** WHETHER THE READER CAN OPEN `path` OF `work` — what makes a `Wrote …` row
 *  on the card's timeline a link: always while the work is in progress (it
 *  saw the file appear), and for a work that has ended only when kolu kept a
 *  copy, since its worktree may be gone. */
export const holdsPath = (work: Work, path: string): boolean =>
  pathsOf(work).has(path);

/** EVERY PATH ANY WORK HOLDS, and the works holding it, in the collection's
 *  order — the index a named path is looked up in. Built once per change of
 *  the works, never per code span or per streamed chunk. */
export type FileHolders = ReadonlyMap<string, ReadonlyArray<WorkId>>;

/** THE INDEX, from readings already taken: each work's paths under the id
 *  that holds them, in the order the works were given. */
export function mergeHolders(
  works: Iterable<readonly [WorkId, ReadonlySet<string>]>,
): FileHolders {
  const index = new Map<string, WorkId[]>();
  for (const [id, paths] of works)
    for (const path of paths) {
      const list = index.get(path) ?? [];
      list.push(id);
      index.set(path, list);
    }
  return index;
}

export function fileHolders(works: ReadonlyMap<WorkId, Work>): FileHolders {
  return mergeHolders([...works].map(([id, work]) => [id, pathsOf(work)]));
}

/** WHAT PRESSING A NAMED PATH DOES, as a sum:
 *
 *  - `plain` — no work holds it: it is code, not a link;
 *  - `open` — one work's file, opened at once;
 *  - `missing` — the turn's works hold no such file yet: say so, in place;
 *  - `choose` — several works hold it: the person picks one. */
export type FileTarget =
  | { readonly kind: "plain" }
  | { readonly kind: "open"; readonly work: WorkId }
  | { readonly kind: "missing"; readonly works: NonEmpty<WorkId> }
  | { readonly kind: "choose"; readonly works: NonEmpty<WorkId> };

/** The holders as a target: one opens, several are a choice. */
const opening = (holders: NonEmpty<WorkId>): FileTarget =>
  holders.length === 1
    ? { kind: "open", work: holders[0] }
    : { kind: "choose", works: holders };

/** THE ONE RULE: which work's `path` a mention in a turn about `turn` opens. */
export function fileTarget(
  holders: FileHolders,
  turn: ReadonlyArray<WorkId>,
  path: string,
): FileTarget {
  const anywhere = nonEmpty(holders.get(path) ?? []);
  if (anywhere === null) return { kind: "plain" };
  const asked = nonEmpty(turn);
  if (asked === null) return opening(anywhere);
  const holding = nonEmpty(asked.filter((id) => anywhere.includes(id)));
  return holding === null
    ? { kind: "missing", works: asked }
    : opening(holding);
}
