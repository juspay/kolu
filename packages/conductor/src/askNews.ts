/**
 * WHAT A SETTLED ASK SAYS — to the transcript row it was said in, and to the
 * Conductor that is owed the ending.
 *
 * Both readings are built off the record AFTER it moved, so what the
 * conversation hears is what the card shows. They live here, apart from
 * {@link ./asking.ts}, because the two writers that settle a question are not
 * the same module: a person's ANSWER is recorded by `asking`, and a question
 * DROPPED by the ending of its work is recorded by the single writer
 * ({@link ./workStore.ts}) in the same step as the ending. One spelling of
 * "what that ask ended as", read by both, and no edge from the writer back
 * into `asking`.
 */

import type { AskAnswer } from "kolu-common/conductor";
import {
  type AnswerFrom,
  dropAsk,
  openAsks,
  type Work,
  type WorkId,
} from "kolu-work";
import type { AnsweredNews } from "./wakeText.ts";

/** How an ask ended, as the record spells it. */
export type AskHow = "answered" | "declined" | "dropped";

/** THE DECISIONS THIS ANSWER SETTLED — the ones that were still open when it
 *  arrived, in the order they were asked. Read BEFORE the record moves,
 *  because afterwards nothing distinguishes them from the answers the request
 *  itself gave in the same ask (a `work_open` whose setup was half `given`
 *  carries both under one id). */
export const stillOpen = (work: Work, ask: string): ReadonlyArray<string> =>
  work.decisions
    .filter((one) => one.ask === ask && one.kind === "asked")
    .map((one) => one.id);

/** What a settled ask's row says happened. `dropped` is the row's
 *  `withdrawn`: the question went away with nobody answering it, which is the
 *  one ending the transcript already spells. */
export const askOutcome = (
  work: Work,
  settled: ReadonlyArray<string>,
  how: AskHow,
): { how: "answered" | "declined" | "withdrawn"; answers: AskAnswer[] } => ({
  how: how === "dropped" ? "withdrawn" : how,
  answers: work.decisions
    .filter((one) => settled.includes(one.id))
    .map((one) => {
      const answer = one.kind === "answered" ? one.answer : null;
      return {
        key: one.id,
        // What was picked, plus what was typed — the values the question was
        // answered with, under the question's own key.
        values:
          answer === null || answer.text === null
            ? (answer?.picked ?? [])
            : [...answer.picked, answer.text],
      };
    }),
});

/** The news one settled ask makes, for the wake that carries it — off the
 *  questions THIS answer settled, so a setup the request half-answered does
 *  not read back its own `given` values as news. */
export const askNews = (
  id: WorkId,
  work: Work,
  ask: string,
  settled: ReadonlyArray<string>,
  how: AskHow,
  from: AnswerFrom | null,
  at: string,
): AnsweredNews => ({
  work: id,
  title: work.title,
  ask,
  from,
  how,
  at,
  answers: work.decisions
    .filter((one) => settled.includes(one.id))
    .map((one) => ({
      question: one.header === "" ? one.question : one.header,
      picked: one.kind === "answered" ? one.answer.picked : [],
      text: one.kind === "answered" ? one.answer.text : null,
      file: one.file,
    })),
});

/** ONE ASK, SETTLED — everything the two readers of that fact need, minted
 *  by whoever settled it so neither reader has to go back to the record. */
export interface SettledAsk {
  readonly ask: string;
  /** What the transcript row it was said in now says. */
  readonly outcome: {
    how: "answered" | "declined" | "withdrawn";
    answers: AskAnswer[];
  };
  /** ... and what the Conductor is woken with. */
  readonly news: AnsweredNews;
}

/** THE WORK ENDED UNDER ITS QUESTIONS — every one still open is recorded as
 *  dropped, and each says so twice over: nobody can answer a question about a
 *  work that is over. The record moves here, in the caller's one write, so
 *  the ending and the dropping are the same step. */
export const dropOpenAsks = (
  id: WorkId,
  work: Work,
  at: string,
): { readonly work: Work; readonly settled: ReadonlyArray<SettledAsk> } => {
  const open = openAsks(work);
  if (open.length === 0) return { work, settled: [] };
  const was = new Map(open.map((ask) => [ask, stillOpen(work, ask)] as const));
  const dropped = open.reduce((one, ask) => dropAsk(one, ask, at), work);
  return {
    work: dropped,
    settled: open.map((ask) => {
      const settled = was.get(ask) ?? [];
      return {
        ask,
        outcome: askOutcome(dropped, settled, "dropped"),
        news: askNews(id, dropped, ask, settled, "dropped", null, at),
      };
    }),
  };
};
