/**
 * KOLU'S OWN QUESTIONS TO THE HUMAN — minted, recorded before anything can
 * answer them, put as the ONE form an agent's elicitation already draws, and
 * read back.
 *
 * Two halves of one concern. The PURE half is the elicitation bridge: a set of
 * questions becomes a `Form`, each with its own "or say it in your own words"
 * box, and the answer comes back split into picks and typed text. That shape
 * revs with `@kolu/acp`, which is why it is spelled in one place. The LIVE
 * half is {@link Asking.put}: the decisions are written when the ask id is
 * MINTED, before anything can answer it, so a person answering from the card
 * the moment it appears cannot land an answer on a work that does not know it
 * was asked.
 */

import type { AskChoice, AskField } from "@kolu/acp/wire";
import type { Form } from "@kolu/acp";
import type { Harness } from "@kolu/acp-harness";
import {
  answerAsk,
  askQuestions,
  dropAsk,
  type AnswerFrom,
  type Question,
} from "kolu-work";
import type { WorkStore } from "./workStore.ts";

/** The suffix of the free-text field attached to a question — the "or say it
 *  in your own words" box beside the options.
 *
 *  Derived from the decision's own id so the two keys travel together and the
 *  answer can be read back without a second map. `~` because a decision id is
 *  a uuid and never contains one. */
export const otherKey = (decision: string): string => `${decision}~other`;

/**
 * THE FORM a set of questions is put as — one field per question, each with
 * its own "other" box attached.
 *
 * Shaped exactly like an agent's elicitation, because it IS one as far as
 * everything downstream is concerned: the row is drawn by the same component,
 * answered by the same procedure, and settled by the same registry. What makes
 * it kolu's is that the row names the work (`Harness.askPerson`).
 *
 * Every question is OPTIONAL (`required: false`). A person answering from the
 * card may answer the one question they came for and leave the rest; a
 * required field would refuse that answer at the harness and leave the row up
 * with nothing said about why.
 */
export const askForm = (
  message: string,
  questions: ReadonlyArray<Question>,
): Form => {
  const fields: AskField[] = [];
  for (const one of questions) {
    const choices: AskChoice[] = one.options.map((option) => ({
      value: option,
      label: option,
      hint: null,
    }));
    fields.push({
      key: one.id,
      label: one.question,
      hint: null,
      kind: one.multiple ? "choices" : "choice",
      choices,
      required: false,
      attachedTo: null,
    });
    fields.push({
      key: otherKey(one.id),
      label: "or say it in your own words",
      hint: null,
      kind: "text",
      choices: [],
      required: false,
      attachedTo: one.id,
    });
  }
  // A question kolu asked is not a tool call and names no place to go: both are
  // facts about the form rather than fields somebody forgot.
  return { message, fields, toolCall: null, link: null };
};

const valuesAt = (
  value: string | number | boolean | Array<string> | undefined,
): ReadonlyArray<string> => {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((one) => one !== "");
  const said = String(value);
  return said === "" ? [] : [said];
};

/** What the human answered one question, as the values `answerAsk` splits into
 *  picks and typed text: whatever they chose, plus whatever they typed in the
 *  box beside it. A question they left alone answers with nothing, which is
 *  what the record then says about it. */
export const pickedValues = (
  content: Readonly<Record<string, string | number | boolean | Array<string>>>,
  decision: string,
): ReadonlyArray<string> => [
  ...valuesAt(content[decision]),
  ...valuesAt(content[otherKey(decision)]),
];

export interface Asking {
  /** Put kolu's own questions to the human as ONE ask the work knows about.
   *  Resolves when the ask has settled, whichever way. */
  readonly put: (
    id: string,
    message: string,
    questions: ReadonlyArray<Question>,
  ) => Promise<{ answered: boolean; ask: string }>;
  /** WHERE A QUESTION WAS ANSWERED FROM, written down BEFORE the answer goes:
   *  the harness settles the question synchronously inside `answer`, so the
   *  ask waiting on it reads this in the same tick. A question about no work
   *  leaves an entry nobody collects — dropped when the next answer under that
   *  id would be, which cannot happen: an id settles once. */
  readonly answeredFrom: (ask: string, from: AnswerFrom) => void;
}

export const asking = (deps: {
  readonly ask: <T>(work: (agent: Harness) => Promise<T>) => Promise<T>;
  readonly store: WorkStore;
}): Asking => {
  /** A map rather than a field because two works can have a question open at
   *  once, and an entry lives only for the round trip between the press and
   *  the settlement. */
  const answeredFrom = new Map<string, AnswerFrom>();
  const nowIso = (): string => new Date().toISOString();

  return {
    answeredFrom: (ask, from) => {
      answeredFrom.set(ask, from);
    },
    put: async (id, message, questions) => {
      const at = nowIso();
      let askId = "";
      const settled = await deps.ask((agent) =>
        // A question the request already answered (`given`) is recorded with
        // the rest but never drawn: nobody is asked what they already said.
        agent.askPerson(
          askForm(
            message,
            questions.filter((one) => one.given === undefined),
          ),
          {
            work: id,
            known: (minted) => {
              askId = minted;
              const work = deps.store.get(id);
              if (work === undefined) return;
              deps.store.save(
                askQuestions(work, { ask: minted, at, questions }),
              );
              deps.store.changed();
            },
          },
        ),
      );
      const settledAt = nowIso();
      const from = answeredFrom.get(askId) ?? null;
      answeredFrom.delete(askId);
      const work = deps.store.get(id);
      if (work !== undefined) {
        // WITHDRAWN is nobody's answer: the conversation that asked it went
        // away, so the decision is DROPPED rather than recorded as a refusal
        // the human never made.
        deps.store.save(
          settled.outcome.how === "withdrawn"
            ? dropAsk(work, askId, settledAt)
            : answerAsk(work, {
                ask: askId,
                at: settledAt,
                from,
                values:
                  settled.outcome.how === "declined"
                    ? null
                    : new Map(
                        questions.map((one) => [
                          one.id,
                          pickedValues(settled.content, one.id),
                        ]),
                      ),
              }),
        );
        deps.store.changed();
      }
      return { answered: settled.outcome.how === "answered", ask: askId };
    },
  };
};
