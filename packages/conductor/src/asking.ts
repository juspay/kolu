import { Array as Arr, Option } from "effect";
import type {
  AskChoice,
  AskField,
  ConductorWorkAskStanding,
} from "kolu-common/conductor";
import {
  answerAsk,
  type AnsweredFromFace,
  type AskReply,
  askQuestions,
  dropQuestions,
  hasOpenAsk,
  isPut,
  type Question,
  type Work,
  type WorkId,
  unneededSetupQuestions,
} from "kolu-work";
import { askNews, askStanding, stillOpen } from "./askNews.ts";
import type { AnsweredNews } from "./wakeText.ts";
import type { WorkStore } from "./workStore.ts";

/** THE FIELDS a set of questions is SAID as, in the transcript's row — one per
 *  question, keyed by the decision it belongs to. */
export const askFields = (
  questions: ReadonlyArray<Question>,
): ReadonlyArray<AskField> =>
  questions.map((one) => {
    const common = {
      key: one.id,
      label: one.question,
      hint: null,

      required: false,
      attachedTo: null,
    };
    switch (one.topic) {
      case "work":
        return {
          ...common,
          kind: one.multiple ? "choices" : "choice",
          choices: one.options.map(
            (option): AskChoice => ({
              value: option,
              label: option,
              hint: null,
            }),
          ),
        };
      case "setup":
        return "options" in one
          ? {
              ...common,
              kind: "choice",
              choices: one.options.map(
                (option): AskChoice => ({
                  value: option,
                  label: option,
                  hint: null,
                }),
              ),
            }
          : { ...common, kind: "text", choices: [] };
      default:
        return one satisfies never;
    }
  });

export type Answered =
  | { readonly kind: "nothing-open" }
  | { readonly kind: "nothing-answered" }
  | { readonly kind: "answered" }
  | { readonly kind: "part"; readonly open: Arr.NonEmptyReadonlyArray<string> }
  | { readonly kind: "declined" };

export interface Asking {
  /** Put kolu's own questions to the human as ONE ask the work knows about —
   *  and ANSWER AT ONCE. `asked` is false when the request had already given
   *  every answer, which is a set of decisions and nobody asked anything. */
  readonly put: (
    work: string,
    message: string,
    questions: ReadonlyArray<Question>,
  ) => { readonly ask: string; readonly asked: boolean };
  /** The human's reply to one ask, from wherever they gave it — a DECLINE
   *  settles the whole of it, an ANSWER settles the questions it gives a
   *  value for and leaves the rest asked. Answers {@link Answered}. */
  readonly answer: (answered: {
    readonly id: WorkId;
    readonly work: Work;
    readonly ask: string;
    readonly from: AnsweredFromFace;
    readonly reply: AskReply;
  }) => Answered;
}

export interface AskingDeps {
  readonly store: Pick<WorkStore, "get" | "save" | "changed">;
  readonly said: (
    ask: string,
    work: string,
    message: string,
    fields: ReadonlyArray<AskField>,
  ) => void;
  readonly settled: (ask: string, standing: ConductorWorkAskStanding) => void;
  readonly news: (news: AnsweredNews) => void;
}

export const asking = (deps: AskingDeps): Asking => {
  const nowIso = (): string => new Date().toISOString();

  return {
    put: (id, message, questions) => {
      const at = nowIso();

      const put = questions.filter(isPut);
      const asked = put.length > 0;
      const ask = asked ? `ask:${crypto.randomUUID()}` : `given:${id}`;
      return Option.match(deps.store.get(id), {
        onNone: () => ({ ask, asked: false }),
        onSome: (work) => {
          deps.store.save(id, askQuestions(work, { ask, at, questions }));
          if (asked) deps.said(ask, id, message, askFields(put));
          deps.store.changed();
          return { ask, asked };
        },
      });
    },

    answer: ({ id, work, ask, from, reply }) => {
      if (!hasOpenAsk(work, ask)) return { kind: "nothing-open" };
      const at = nowIso();
      const was = stillOpen(work, ask);
      const recorded = answerAsk(work, { ask, at, from, reply });

      if (recorded === work) return { kind: "nothing-answered" };

      const moot = unneededSetupQuestions(recorded);
      const answered = dropQuestions(recorded, moot, at);
      deps.store.save(id, answered);
      deps.store.changed();
      const how = reply.kind === "declined" ? "declined" : "answered";
      deps.settled(ask, askStanding(answered, ask, how));
      deps.news(
        askNews(
          id,
          answered,
          ask,
          was.filter((one) => !moot.has(one)),
          { how, from },
          at,
        ),
      );
      if (how === "declined") return { kind: "declined" };

      const open = stillOpen(answered, ask);
      return Arr.isReadonlyArrayNonEmpty(open)
        ? { kind: "part", open }
        : { kind: "answered" };
    },
  };
};
