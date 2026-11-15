/**
 * KOLU'S OWN QUESTIONS TO THE HUMAN — minted, recorded, SAID in the
 * conversation, and answered later from wherever the person happens to be.
 *
 * NOTHING HERE WAITS. A question about a piece of work is a DECISION on that
 * work with no answer yet: it is written when the ask id is minted, before
 * anything can answer it, and the call that asked it returns at once. The
 * Conductor's turn ends; when somebody answers, {@link Asking.answer} records
 * it and the conversation is WOKEN with what they said.
 *
 * That is the whole of why this module no longer touches the agent. Asking
 * used to be an elicitation whose promise the tool call awaited, which made
 * the Conductor's turn sit in a wait for as long as a person took to read a
 * plan — and an MCP client gives up on a tool call that says nothing for five
 * minutes ("sent no response or progress for 300s; aborting"). A question is
 * not a tool call that runs slowly; it is a thing the record holds until
 * somebody answers it, which is what it is now.
 *
 * The question is SAID in the transcript too — one row where it was asked, so
 * the chat reads as a conversation rather than as a card referring to one.
 * That row is the conversation's log: it is minted when the question goes and
 * settled with what was said. The WORK is the record, and every face that
 * offers the question to a person reads it there.
 */

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

/**
 * THE FIELDS a set of questions is SAID as, in the transcript's row — one per
 * question, keyed by the decision it belongs to.
 *
 * A log of what was asked, not a form: the thing a person presses is drawn
 * from the work's decisions ({@link ../../client/src/conductor/WorkQuestion.tsx}),
 * which is the one copy that can be answered. These fields exist so the row,
 * and the clipboard's copy of the transcript, say what was asked and what was
 * answered without reaching for the work.
 *
 * The typed answer rides back under the question's OWN key beside its picks,
 * so there is no second "other" key to read back.
 */
export const askFields = (
  questions: ReadonlyArray<Question>,
): ReadonlyArray<AskField> =>
  questions.map((one) => {
    const common = {
      key: one.id,
      label: one.question,
      hint: null,
      // Every question is optional: a person may answer the one they came for
      // and leave the rest, and the record says exactly that about the others
      // — they are still asked.
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
        // A question kolu draws the options for has none to log: they are
        // read live off the listing and the host, and the answer is logged as
        // text. The other two are answered in kolu's own words.
        return "options" in one
          ? {
              ...common,
              // One answer each: a setup question with two answers is two
              // questions.
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

/** WHAT A REPLY DID TO AN ASK — the sum every face and the Conductor itself
 *  branch on.
 *
 *   - `nothing-open` — the ask had nothing left to settle: somebody else
 *     answered it first, or the work ended under it. A reported state in a
 *     two-tab world, not a fault.
 *   - `nothing-answered` — the reply fills in no question at all. Nothing is
 *     recorded and every question is still asked; the caller refuses it
 *     rather than reporting a settlement that did not happen.
 *   - `part` — some questions were filled in and the rest are STILL ASKED,
 *     by id: the form stays in front of the person, in the chat and on the
 *     card.
 *   - `answered` / `declined` — nothing of the ask is open any more. */
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
   *  value for and leaves the rest asked. Answers {@link Answered}. What the
   *  Conductor is told about it goes to {@link AskingDeps.news}: holding news
   *  and flushing it is one rule in one place, not a thing each caller
   *  remembers. */
  readonly answer: (answered: {
    readonly id: WorkId;
    readonly work: Work;
    readonly ask: string;
    readonly from: AnsweredFromFace;
    readonly reply: AskReply;
  }) => Answered;
}

export interface AskingDeps {
  /** The three things asking does with the works: read one, write it back,
   *  and say something moved. */
  readonly store: Pick<WorkStore, "get" | "save" | "changed">;
  /** KOLU'S QUESTION, SAID in the conversation — one row, minted under the
   *  ask's own id. */
  readonly said: (
    ask: string,
    work: string,
    message: string,
    fields: ReadonlyArray<AskField>,
  ) => void;
  /** ... and where it stands now, on that same row — including `part`, which
   *  is a row that is still being answered. */
  readonly settled: (ask: string, standing: ConductorWorkAskStanding) => void;
  /** The human's answer as NEWS — held and flushed by the one module that
   *  owns waking the Conductor. */
  readonly news: (news: AnsweredNews) => void;
}

export const asking = (deps: AskingDeps): Asking => {
  const nowIso = (): string => new Date().toISOString();

  return {
    put: (id, message, questions) => {
      const at = nowIso();
      // EVERY ANSWER ALREADY GIVEN is a set of decisions the REQUEST made, and
      // nobody is asked anything: the human said where and how in the message
      // that started this, and a form putting it back to them is the "you
      // already told me, say it again" this whole shape removes.
      const put = questions.filter(isPut);
      const asked = put.length > 0;
      const ask = asked ? `ask:${crypto.randomUUID()}` : `given:${id}`;
      return Option.match(deps.store.get(id), {
        onNone: () => ({ ask, asked: false }),
        onSome: (work) => {
          // WRITTEN BEFORE ANYTHING CAN ANSWER IT. A person pressing the card
          // the moment it appears must not land an answer on a work that does
          // not know it was asked.
          deps.store.save(id, askQuestions(work, { ask, at, questions }));
          deps.store.changed();
          if (asked) deps.said(ask, id, message, askFields(put));
          return { ask, asked };
        },
      });
    },

    answer: ({ id, work, ask, from, reply }) => {
      if (!hasOpenAsk(work, ask)) return { kind: "nothing-open" };
      const at = nowIso();
      const was = stillOpen(work, ask);
      const recorded = answerAsk(work, { ask, at, from, reply });
      // A REPLY THAT FILLS IN NOTHING MOVES NOTHING — the record hands back
      // the same work, every question is still asked, and the caller says so
      // rather than reporting a settlement that did not happen.
      if (recorded === work) return { kind: "nothing-answered" };
      // ... and AN ANSWERED MODE TAKES THE QUESTIONS IT DOES NOT RUN WITH IT:
      // a planner's harness left blank on a form answered `trivial` is not a
      // question in front of anybody, and the news does not call it open.
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
      // WHAT IS STILL IN FRONT OF THEM: the questions of this ask they left
      // blank, which are open decisions still.
      const open = stillOpen(answered, ask);
      return Arr.isReadonlyArrayNonEmpty(open)
        ? { kind: "part", open }
        : { kind: "answered" };
    },
  };
};
