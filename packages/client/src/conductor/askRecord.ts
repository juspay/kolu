/** AN ANSWERED QUESTION, READ BACK — the one reading shared by the card and
 *  the clipboard.
 *
 *  A question that has been answered is still a question: what a person wants
 *  to see a day later is *what was asked* and *what they said*, and a card
 *  that collapses to the bare word `answered` has thrown both away. The row
 *  already carries everything needed to say it — the fields the agent sent and
 *  the values that went back ({@link ConductorAskRow}'s `ask.outcome.answers`,
 *  kept since the conversation was first written to disk) — so this is a
 *  reading rather than a new fact on the wire.
 *
 *  Pure, and its own module, because TWO things draw it: the settled card
 *  ({@link ./ConductorAsk.tsx}) and `Copy transcript`
 *  ({@link ./transcript.ts}). A clipboard cannot reach into a component, and a
 *  transcript that said something different from the screen would be the kind
 *  of disagreement nobody notices until they paste it into an issue.
 *
 *  VALUES ARE SHOWN AS THEY WERE PICKED, not as they travel: an answer is
 *  always strings on the wire ({@link AskAnswer}), so `30` is what the browser
 *  sent for a chip labelled `30 days` and `true` is what it sent for `Yes`.
 *  The label the person actually pressed is in the field's own `choices`, and
 *  that is what a record of the conversation has to say back. */

import {
  type AskAnswer,
  type AskField,
  type ConductorAskRow,
  YES_NO,
} from "kolu-common/conductor";

/** One question, with what was said to it. `answer` is `null` when nothing was
 *  recorded for it — a field left alone, a declined form, or a card settled
 *  before answers were kept at all. The question is still listed: that it went
 *  unanswered is part of the record. */
export interface AskRecordLine {
  readonly key: string;
  readonly question: string;
  readonly answer: string | null;
}

/** Several picks (a multi-select, or a choice plus its "Other" box) on one
 *  line. The same separator the panel uses between facts elsewhere. */
const JOIN = " · ";

/** The fields that are questions in their own right — an `attachedTo` field is
 *  the free-text "other" for the one it names and belongs inside that
 *  question's block, never as a question of its own. */
export const askQuestions = (row: ConductorAskRow): ReadonlyArray<AskField> =>
  row.ask.fields.filter((field) => field.attachedTo === null);

/**
 * THE ASK'S OWN SENTENCE, when it is worth printing, else `null`.
 *
 * Agents bridging an "ask the user" tool onto ACP send a wrapper line with the
 * form — Claude Code's is `Please answer the following questions.` — which is
 * not a question and not context: it is the adapter saying what the fields
 * already are. Printed above a card that leads with `Mode` and `Implementor`
 * it is noise, and it was the whole of what a settled card used to show.
 *
 * So the message is drawn when it CARRIES the question and withheld when the
 * fields do:
 *   - no fields at all (a permission request, a sign-in link) — the message is
 *     the entire ask, and this is the case the rule must not break;
 *   - a question field with no label — a single question travels as the ask's
 *     message with an unlabelled field under it ({@link AskField}'s `label`),
 *     so withholding it would leave a box with nothing asked above it.
 * Every field labelled means the card can say what was asked without it.
 */
export const askLead = (row: ConductorAskRow): string | null => {
  const questions = askQuestions(row);
  if (questions.length === 0) return row.text;
  return questions.some((field) => field.label === null) ? row.text : null;
};

/** What to call one question on its line. Its label, or — for the single
 *  unlabelled field whose question IS the ask's message — that message. A key
 *  is the last resort rather than the first: `question_0` says nothing. */
const questionText = (
  row: ConductorAskRow,
  field: AskField,
  questions: ReadonlyArray<AskField>,
): string => {
  if (field.label !== null) return field.label;
  return questions.length === 1 ? row.text : field.key;
};

/** One value as it was offered. A chip's label for a choice, `Yes`/`No` for a
 *  boolean, and the typed characters for everything else — a text box's answer
 *  is already what was written. */
const valueText = (field: AskField, value: string): string => {
  const choice = field.choices.find((one) => one.value === value);
  if (choice !== undefined) return choice.label;
  if (field.kind === "boolean") {
    if (value === YES_NO.yes) return "Yes";
    if (value === YES_NO.no) return "No";
  }
  return value;
};

/** Every value recorded for one key, in the order they were sent. */
const valuesFor = (
  answers: ReadonlyArray<AskAnswer>,
  key: string,
): ReadonlyArray<string> =>
  answers.filter((answer) => answer.key === key).flatMap((one) => one.values);

/**
 * The ask as a record: each question, with the answer on its line.
 *
 * The "Other" box's text joins the question it was attached to rather than
 * appearing as a line of its own, because that is how it was asked and how it
 * was answered — one question, a pick and the words beside it
 * (`Implementor — omp · anthropic/claude-opus-5-5`).
 *
 * Works on an UNSETTLED row too (every answer `null`), so the clipboard can
 * carry a question still waiting without a second shape for it.
 */
export const askRecord = (
  row: ConductorAskRow,
): ReadonlyArray<AskRecordLine> => {
  const answers = row.ask.outcome?.answers ?? [];
  const questions = askQuestions(row);
  return questions.map((field) => {
    const other = row.ask.fields.find((one) => one.attachedTo === field.key);
    const values = [
      ...valuesFor(answers, field.key).map((value) => valueText(field, value)),
      ...(other === undefined
        ? []
        : valuesFor(answers, other.key).map((value) =>
            valueText(other, value),
          )),
    ];
    return {
      key: field.key,
      question: questionText(row, field, questions),
      answer: values.length === 0 ? null : values.join(JOIN),
    };
  });
};
