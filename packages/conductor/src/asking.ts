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

import type { AskAnswer, AskChoice, AskField } from "@kolu/acp/wire";
import {
  answerAsk,
  type AnswerFrom,
  askQuestions,
  hasOpenAsk,
  type Question,
  type Work,
  type WorkId,
} from "kolu-work";
import { askNews, askOutcome, stillOpen } from "./askNews.ts";
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
    const choices: AskChoice[] = one.options.map((option) => ({
      value: option,
      label: option,
      hint: null,
    }));
    return {
      key: one.id,
      label: one.question,
      hint: null,
      kind: one.multiple ? "choices" : "choice",
      choices,
      // Every question is optional: a person may answer the one they came for
      // and leave the rest, and the record says exactly that about the others.
      required: false,
      attachedTo: null,
    };
  });

export interface Asking {
  /** Put kolu's own questions to the human as ONE ask the work knows about —
   *  and ANSWER AT ONCE. `asked` is false when the request had already given
   *  every answer, which is a set of decisions and nobody asked anything. */
  readonly put: (
    work: string,
    message: string,
    questions: ReadonlyArray<Question>,
  ) => { readonly ask: string; readonly asked: boolean };
  /** The human's answer to one ask, from wherever they gave it — `null`
   *  values DECLINE the whole ask. Answers HOW the ask was settled, or
   *  `null` when it had nothing open (somebody else got there first). What
   *  the Conductor is told about it goes to {@link AskingDeps.news}: holding
   *  news and flushing it is one rule in one place, not a thing each caller
   *  remembers.  */
  readonly answer: (answered: {
    readonly id: WorkId;
    readonly work: Work;
    readonly ask: string;
    readonly from: AnswerFrom;
    readonly values: ReadonlyMap<string, ReadonlyArray<string>> | null;
  }) => "answered" | "declined" | null;
}

export interface AskingDeps {
  readonly store: WorkStore;
  /** KOLU'S QUESTION, SAID in the conversation — one row, minted under the
   *  ask's own id. */
  readonly said: (
    ask: string,
    work: string,
    message: string,
    fields: ReadonlyArray<AskField>,
  ) => void;
  /** ... and how it ended, on that same row. */
  readonly settled: (
    ask: string,
    outcome: {
      how: "answered" | "declined" | "withdrawn";
      answers: AskAnswer[];
    },
  ) => void;
  /** The human's answer as NEWS — held and flushed by the one module that
   *  owns waking the Conductor. */
  readonly news: (news: AnsweredNews) => void;
}

export const asking = (deps: AskingDeps): Asking => {
  const nowIso = (): string => new Date().toISOString();

  return {
    put: (id, message, questions) => {
      const at = nowIso();
      const work = deps.store.get(id);
      // EVERY ANSWER ALREADY GIVEN is a set of decisions the REQUEST made, and
      // nobody is asked anything: the human said where and how in the message
      // that started this, and a form putting it back to them is the "you
      // already told me, say it again" this whole shape removes.
      const asked = questions.some((one) => one.given === undefined);
      const ask = asked ? `ask:${crypto.randomUUID()}` : `given:${id}`;
      if (work === undefined) return { ask, asked: false };
      // WRITTEN BEFORE ANYTHING CAN ANSWER IT. A person pressing the card the
      // moment it appears must not land an answer on a work that does not
      // know it was asked.
      deps.store.save(id, askQuestions(work, { ask, at, questions }));
      deps.store.changed();
      if (asked) {
        deps.said(
          ask,
          id,
          message,
          askFields(questions.filter((one) => one.given === undefined)),
        );
      }
      return { ask, asked };
    },

    answer: ({ id, work, ask, from, values }) => {
      if (!hasOpenAsk(work, ask)) return null;
      const at = nowIso();
      const settled = stillOpen(work, ask);
      const how = values === null ? "declined" : "answered";
      const answered = answerAsk(work, { ask, at, from, values });
      deps.store.save(id, answered);
      deps.store.changed();
      deps.settled(ask, askOutcome(answered, settled, how));
      deps.news(askNews(id, answered, ask, settled, how, from, at));
      return how;
    },
  };
};
