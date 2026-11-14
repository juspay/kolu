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
  dropAsk,
  hasOpenAsk,
  openAsks,
  type Question,
  type Work,
} from "kolu-work";
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

/** THE DECISIONS THIS ANSWER SETTLED — the ones that were still open when it
 *  arrived, in the order they were asked. Read BEFORE the record moves,
 *  because afterwards nothing distinguishes them from the answers the request
 *  itself gave in the same ask (a `work_open` whose setup was half `given`
 *  carries both under one id). */
const stillOpen = (work: Work, ask: string): ReadonlyArray<string> =>
  work.decisions
    .filter((one) => one.ask === ask && one.answer === null)
    .map((one) => one.id);

/** What a settled ask's row says happened. `dropped` is the row's
 *  `withdrawn`: the question went away with nobody answering it, which is the
 *  one ending the transcript already spells. */
const outcomeOf = (
  work: Work,
  settled: ReadonlyArray<string>,
  how: "answered" | "declined" | "dropped",
): { how: "answered" | "declined" | "withdrawn"; answers: AskAnswer[] } => ({
  how: how === "dropped" ? "withdrawn" : how,
  answers: work.decisions
    .filter((one) => settled.includes(one.id))
    .map((one) => {
      const answer = one.answer;
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

/** The news one settled ask makes, for the wake that carries it. Built off
 *  the record after it moved, so what the Conductor is told is what the card
 *  shows — and off the questions THIS answer settled, so a setup the request
 *  half-answered does not read back its own `given` values as news. */
const newsOf = (
  work: Work,
  ask: string,
  settled: ReadonlyArray<string>,
  how: "answered" | "declined" | "dropped",
  from: AnswerFrom | null,
  at: string,
): AnsweredNews => ({
  work: work.id,
  title: work.title,
  ask,
  from,
  how,
  at,
  answers: work.decisions
    .filter((one) => settled.includes(one.id))
    .map((one) => ({
      question: one.header === "" ? one.question : one.header,
      picked: one.answer?.picked ?? [],
      text: one.answer?.text ?? null,
      file: one.file,
    })),
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
   *  values DECLINE the whole ask. Answers the news for the wake, or `null`
   *  when that ask had nothing open (somebody else got there first). */
  readonly answer: (answered: {
    readonly work: Work;
    readonly ask: string;
    readonly from: AnswerFrom;
    readonly values: ReadonlyMap<string, ReadonlyArray<string>> | null;
  }) => AnsweredNews | null;
  /** EVERY QUESTION A WORK STILL HAS OPEN, DROPPED — the work ended under
   *  them, so nobody will ever answer them. The news is the Conductor's: it
   *  asked, and it is owed the ending whichever ending it was. */
  readonly drop: (work: Work) => ReadonlyArray<AnsweredNews>;
}

export const asking = (deps: {
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
}): Asking => {
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
      deps.store.save(askQuestions(work, { ask, at, questions }));
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

    answer: ({ work, ask, from, values }) => {
      if (!hasOpenAsk(work, ask)) return null;
      const at = nowIso();
      const settled = stillOpen(work, ask);
      const how = values === null ? "declined" : "answered";
      const answered = answerAsk(work, { ask, at, from, values });
      deps.store.save(answered);
      deps.store.changed();
      deps.settled(ask, outcomeOf(answered, settled, how));
      return newsOf(answered, ask, settled, how, from, at);
    },

    drop: (work) => {
      const open = openAsks(work);
      if (open.length === 0) return [];
      const at = nowIso();
      const settled = new Map(
        open.map((ask) => [ask, stillOpen(work, ask)] as const),
      );
      const dropped = open.reduce((one, ask) => dropAsk(one, ask, at), work);
      deps.store.save(dropped);
      deps.store.changed();
      for (const ask of open) {
        deps.settled(
          ask,
          outcomeOf(dropped, settled.get(ask) ?? [], "dropped"),
        );
      }
      return open.map((ask) =>
        newsOf(dropped, ask, settled.get(ask) ?? [], "dropped", null, at),
      );
    },
  };
};
