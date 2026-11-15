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

import { Array as Arr, Option } from "effect";
import type {
  ConductorWorkAnswer,
  ConductorWorkAskStanding,
} from "kolu-common/conductor";
import {
  type AnsweredFromFace,
  type Decision,
  dropAsk,
  dropQuestions,
  hasOpenAsk,
  openAsks,
  type Settled,
  type Work,
  type WorkId,
} from "kolu-work";
import type { AnsweredNews, NewsQuestion, NewsSaid } from "./wakeText.ts";

/** WHAT A REPLY WAS, and — where a person made it — the face they made it
 *  from. A DROPPED ask has no face: nobody answered it. */
export type AskHow =
  | { readonly how: "answered"; readonly from: AnsweredFromFace }
  | { readonly how: "declined"; readonly from: AnsweredFromFace }
  | { readonly how: "dropped" };

/** THE DECISIONS A REPLY WAS ABOUT — the ones that were still open when it
 *  arrived, in the order they were asked. Read BEFORE the record moves,
 *  because afterwards nothing distinguishes them from the answers the request
 *  itself gave in the same ask (a `work_open` whose setup was half `given`
 *  carries both under one id) — and because a question left blank is still
 *  open afterwards, which is a thing the news has to say about it.
 *
 *  Not "what it settled": an answer settles only the questions it gives a
 *  value for ({@link answerAsk}), and the rest of this list is what is still
 *  in front of the human. */
export const stillOpen = (work: Work, ask: string): ReadonlyArray<string> =>
  work.decisions
    .filter((one) => one.ask === ask && one.kind === "asked")
    .map((one) => one.id);

/** WHAT ONE SETTLED QUESTION WAS ANSWERED WITH — none for one that was
 *  declined or dropped, which is what those arms mean. The record's own two
 *  shapes: one of kolu's words for a setup question, what was said for a
 *  question about the work. */
const saidOf = (one: Settled): Option.Option<NewsSaid> =>
  one.topic === "work"
    ? one.answer.how === "answered"
      ? Option.some<NewsSaid>({ kind: "said", said: one.answer.said })
      : Option.none()
    : one.answer.how === "answered"
      ? Option.some<NewsSaid>({ kind: "value", value: one.answer.value })
      : Option.none();

/** ... and the words it is named by: a setup question is its KEY (the name
 *  kolu asks and reads it back under), a question about the work is its short
 *  header, or the whole question when it was given none. */
const labelOf = (one: Decision): string =>
  one.topic === "work"
    ? one.header.kind === "header"
      ? one.header.text
      : one.question
    : one.key;

/** The values a face logs for one answered question — the picks, and the
 *  words typed beside them. */
const valuesOf = (said: NewsSaid): ReadonlyArray<string> => {
  if (said.kind === "value") return [said.value];
  switch (said.said.kind) {
    case "picked":
      return [...said.said.picked];
    case "typed":
      return [said.said.text];
    case "picked-and-typed":
      return [...said.said.picked, said.said.text];
    default:
      return said.said satisfies never;
  }
};

/** WHAT A PERSON FILLED IN ON THIS FORM, by decision — every question of the
 *  ask a face answered. An answer the REQUEST gave is not one of them: it was
 *  never put to anybody, so the row that logs the form has no field for it. */
const filledIn = (
  work: Work,
  ask: string,
): ReadonlyArray<ConductorWorkAnswer> =>
  work.decisions.flatMap((one) => {
    if (one.ask !== ask || one.kind !== "settled") return [];
    if (one.answer.how === "answered" && one.answer.from === "request")
      return [];
    if (one.answer.how === "answered" && one.answer.from === "carried-over")
      return [];
    return Option.match(saidOf(one), {
      onNone: (): ReadonlyArray<ConductorWorkAnswer> => [],
      onSome: (said) => {
        const values = valuesOf(said);
        return Arr.isReadonlyArrayNonEmpty(values)
          ? [{ key: one.id, values }]
          : [];
      },
    });
  });

/** WHERE THE ROW IN THE CHAT STANDS after a reply — the same fact the work's
 *  decisions hold, said in the row the questions were asked in.
 *
 *  `part` is bug 2 in the chat: what was filled in is logged and the rest is
 *  still asked, in the same row, so the form a person left half done is the
 *  form they come back to. */
export const askStanding = (
  work: Work,
  ask: string,
  how: AskHow["how"],
): ConductorWorkAskStanding => {
  if (how === "dropped") return { kind: "withdrawn" };
  if (how === "declined") return { kind: "declined" };
  const answers = filledIn(work, ask);
  if (!Arr.isReadonlyArrayNonEmpty(answers))
    throw new Error(
      `askStanding: ${ask} was answered with nothing filled in — a reply that settles nothing is refused before it reaches the record`,
    );
  return hasOpenAsk(work, ask)
    ? { kind: "part", answers }
    : { kind: "answered", answers };
};

/** The news one reply makes, for the wake that carries it — off the questions
 *  that were OPEN when it arrived, so a setup the request half-answered does
 *  not read back its own `given` values as news, and a question left blank
 *  says that it is still open rather than vanishing from the account. */
export const askNews = (
  id: WorkId,
  work: Work,
  ask: string,
  was: ReadonlyArray<string>,
  how: AskHow,
  at: string,
): AnsweredNews => {
  const questions = work.decisions
    .filter((one) => was.includes(one.id))
    .map((one): NewsQuestion => {
      const question = labelOf(one);
      if (one.kind === "asked") return { question, how: "open" };
      return Option.match(saidOf(one), {
        onNone: (): NewsQuestion => ({
          question,
          how: one.answer.how === "declined" ? "declined" : "dropped",
        }),
        onSome: (said): NewsQuestion => ({ question, how: "answered", said }),
      });
    });
  const common = { work: id, title: work.title, ask, at, questions };
  switch (how.how) {
    case "answered":
      return { ...common, how: "answered", from: how.from };
    case "declined":
      return { ...common, how: "declined", from: how.from };
    case "dropped":
      return { ...common, how: "dropped" };
    default:
      return how satisfies never;
  }
};

/** ONE ASK, SETTLED — everything the two readers of that fact need, minted
 *  by whoever settled it so neither reader has to go back to the record. */
export interface SettledAsk {
  readonly ask: string;
  /** What the transcript row it was said in now says. */
  readonly standing: ConductorWorkAskStanding;
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
    settled: open.map((ask) => ({
      ask,
      standing: askStanding(dropped, ask, "dropped"),
      news: askNews(
        id,
        dropped,
        ask,
        Option.getOrElse(Option.fromUndefinedOr(was.get(ask)), () => []),
        { how: "dropped" },
        at,
      ),
    })),
  };
};

/** THE OPEN QUESTIONS A NEW FORM TAKES THE PLACE OF — dropped on the record,
 *  and the row of any ask they leave with nothing open settled as
 *  `withdrawn`, exactly as {@link dropOpenAsks} does it.
 *
 *  NO NEWS. The Conductor itself asked for this (it called `work_open` again,
 *  and the questions it is about to put supersede these), so there is nobody
 *  to wake about it — unlike a work ending under its questions, which is
 *  something that happened TO the conversation. */
export const dropSuperseded = (
  work: Work,
  ids: ReadonlySet<string>,
  at: string,
): {
  readonly work: Work;
  readonly settled: ReadonlyArray<{
    readonly ask: string;
    readonly standing: ConductorWorkAskStanding;
  }>;
} => {
  if (ids.size === 0) return { work, settled: [] };
  const asks = new Set(
    work.decisions.filter((one) => ids.has(one.id)).map((one) => one.ask),
  );
  const dropped = dropQuestions(work, ids, at);
  return {
    work: dropped,
    settled: [...asks].flatMap((ask) =>
      hasOpenAsk(dropped, ask)
        ? []
        : [{ ask, standing: askStanding(dropped, ask, "dropped") }],
    ),
  };
};
