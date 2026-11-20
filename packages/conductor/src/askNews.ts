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

export type AskHow =
  | { readonly how: "answered"; readonly from: AnsweredFromFace }
  | { readonly how: "declined"; readonly from: AnsweredFromFace }
  | { readonly how: "dropped" };

export const stillOpen = (work: Work, ask: string): ReadonlyArray<string> =>
  work.decisions
    .filter((one) => one.ask === ask && one.kind === "asked")
    .map((one) => one.id);

const saidOf = (one: Settled): Option.Option<NewsSaid> =>
  one.topic === "work"
    ? one.answer.how === "answered"
      ? Option.some<NewsSaid>({ kind: "said", said: one.answer.said })
      : Option.none()
    : one.answer.how === "answered"
      ? Option.some<NewsSaid>({ kind: "value", value: one.answer.value })
      : Option.none();

const labelOf = (one: Decision): string =>
  one.topic === "work"
    ? one.header.kind === "header"
      ? one.header.text
      : one.question
    : one.key;

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

export interface SettledAsk {
  readonly ask: string;

  readonly standing: ConductorWorkAskStanding;

  readonly news: AnsweredNews;
}

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
