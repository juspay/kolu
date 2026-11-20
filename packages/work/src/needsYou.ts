import { Option } from "effect";
import { type Standing, standing, WAITER_OF, type WorkRow } from "./folds.ts";
import type { Work, WorkId } from "./schema.ts";
import { policyOf } from "./waterfall.ts";

/** WHY A WORK NEEDS THE HUMAN — the two arms of {@link Standing} that wait on
 *  them, and nothing else. */
export type NeedsYouWhy = Extract<Standing, { why: "question" | "merge" }>;

/** One wait on the human. */
export interface NeedsYou {
  /** The id the work is filed under. */
  readonly work: WorkId;
  readonly title: string;
  readonly why: NeedsYouWhy;
  /** When the wait began — the moment `standing` last changed hands. */
  readonly since: string;
  /** What is wanted, in a few words: the question's own, or the merge. */
  readonly wanted: string;
  /** THE ITEM'S IDENTITY — the work, the reason, and the ask or the commit
   *  that is green. Two readings with the same key are the SAME wait: a PR
   *  whose merge answer flickers can, cannot, can on one commit is one item
   *  however many times it leaves the list and comes back, and a second
   *  commit going green is a new one. */
  readonly key: string;
}

/** WHAT A WAIT ON THE HUMAN ASKS FOR, in a few words — the question's own,
 *  or the merge with the PR by number when the timeline knows one. The card's
 *  line, the palette's row and the notification all say this. */
export const wantedWords = (why: NeedsYouWhy): string =>
  why.why === "question"
    ? why.question
    : Option.match(why.pr, {
        onNone: () => "Merge the PR",
        onSome: (green) => `Merge PR #${green.number}`,
      });

const keyOf = (work: WorkId, why: NeedsYouWhy): string =>
  JSON.stringify(
    why.why === "question"
      ? [work, "question", why.ask]
      : [
          work,
          "merge",
          ...Option.match(why.pr, {
            onNone: () => ["unknown"],
            onSome: (green) => [
              String(green.number),
              green.head.kind === "commit" ? green.head.sha : "unreported",
            ],
          }),
        ],
  );

const onYou = (at: Standing): at is NeedsYouWhy => WAITER_OF[at.why] === "you";

/** THE ONE WORK'S WAIT ON THE HUMAN, if it is waiting on them. */
export const needsYouOf = (
  work: WorkId,
  record: Work,
): Option.Option<NeedsYou> => {
  const why = standing(record, policyOf(record));
  if (!onYou(why)) return Option.none();
  return Option.some({
    work,
    title: record.title,
    why,
    since: why.since,
    wanted: wantedWords(why),
    key: keyOf(work, why),
  });
};

/** EVERYTHING THAT NEEDS THE HUMAN, in the order the works are given. */
export const needsYou = (
  works: ReadonlyArray<WorkRow>,
): ReadonlyArray<NeedsYou> =>
  works.flatMap(([id, work]) => Option.toArray(needsYouOf(id, work)));
