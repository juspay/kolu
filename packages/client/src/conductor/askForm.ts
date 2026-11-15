/** ONE ASK'S FORM, as the draft holds it — the keys a question keeps beside
 *  its own, the single-answer behaviour every face shares, and THE RULE THAT
 *  TELLS AN UNTOUCHED QUESTION FROM A CLEARED ONE.
 *
 *  WHY A SEED AND A MARK. A setup question opens with what this person chose
 *  last time on this host ({@link SetupMemory}), already selected, so that
 *  with nothing changed one press of Answer sends the whole setup. "Already
 *  selected" is not a highlight drawn over an empty draft: it IS the draft,
 *  written once, which is what makes it travel — `answers()` reads the draft
 *  and nothing has to remember a second kind of selection.
 *
 *  Writing it once is the whole of it. A draft that merely *defaults* while
 *  empty cannot tell "nobody has touched this" from "they took the pick off
 *  on purpose", and would put the default back under their hands. So the mark
 *  ({@link seedAskDefault}) records that this question has been seeded for a
 *  given CONTEXT, and after that the draft is the person's — empty included.
 *
 *  THE CONTEXT IS WHAT THE OPTIONS ARE OF. For a model it is the harness,
 *  because a model is only ever a model of one: switching the harness in the
 *  same form does not carry the old pick across (it is not a model of the new
 *  harness), so that question seeds again, with the harness's own last model.
 *  For every other question the context is a constant and one seeding is all
 *  there ever is.
 *
 *  The mark lives in the ask's own draft, so it is shared by the four faces
 *  exactly as the pick is — a form half-filled on the card and finished in
 *  the reader seeds once — and `forgetAskDraft` takes it with everything else
 *  when the question is answered.
 */

import { Option } from "effect";
import { type Accessor, batch, createEffect, createMemo } from "solid-js";
import { type AskOption, defaultFirst } from "./AskOptions";
import { askDraft, dropAskFields, setAskDraft } from "./drafts";

/** The free-text half of a question, under its own key beside the decision's
 *  — `~` because a decision id is a uuid and never contains one. */
export const typedKey = (decision: string): string => `${decision}~typed`;

/** ... and the mark that says this question has already been seeded with its
 *  default, for the options it was seeded against. */
const seededKey = (decision: string): string => `${decision}~seeded`;

/** An option pressed on a SINGLE-answer question: it keeps the one pressed
 *  last and empties the box beside it — the options and the box are two
 *  halves of one question. */
export function pickOnly(ask: string, field: string, value: string): void {
  batch(() => {
    setAskDraft(ask, field, [value]);
    setAskDraft(ask, typedKey(field), []);
  });
}

/** Words typed beside a single-answer question's options. The first character
 *  of an own answer drops the pick, as you watch. */
export function typeOnly(ask: string, field: string, text: string): void {
  batch(() => {
    setAskDraft(ask, typedKey(field), text === "" ? [] : [text]);
    if (text !== "") setAskDraft(ask, field, []);
  });
}

/** SEED THE DEFAULT, ONCE PER CONTEXT — the write {@link seededChips} owns.
 *  `value` is what this person answered last time AND can be answered again
 *  here (an option that is drawn, or any word for a question that takes
 *  words) — none when there is no such answer, which seeds the question
 *  empty rather than leaving it to be seeded later by something stale.
 *
 *  It is called only once the options ARE known: a question seeded against a
 *  list that has not arrived would mark itself done and never offer the
 *  default.
 */
function seedAskDefault(
  ask: string,
  field: string,
  context: string,
  value: Option.Option<string>,
): void {
  if (askDraft(ask, seededKey(field))[0] === context) return;
  batch(() => {
    setAskDraft(ask, seededKey(field), [context]);
    setAskDraft(ask, field, Option.toArray(value));
    setAskDraft(ask, typedKey(field), []);
  });
}

/** DEFAULT FIRST, SEEDED ONCE — the whole of how a question opens on what
 *  this person chose last time, in one place because every form does both
 *  halves or neither: the default leads the options drawn ({@link
 *  defaultFirst}), and the same value is written into the draft once per
 *  context ({@link seedAskDefault}) so it is also selected.
 *
 *  A context of NONE is a question with no default to seed — the options
 *  have not arrived, or this question has no memory behind it — and nothing
 *  is marked, so it seeds when they do.
 */
export function seededChips(
  ask: string,
  field: string,
  context: () => Option.Option<string>,
  options: () => ReadonlyArray<AskOption>,
  standing: () => Option.Option<string>,
): Accessor<ReadonlyArray<AskOption>> {
  createEffect(() => {
    Option.match(context(), {
      onNone: () => {},
      onSome: (now) => seedAskDefault(ask, field, now, standing()),
    });
  });
  return createMemo(() => defaultFirst(options(), standing()));
}

/** THE QUESTIONS WHOSE DRAFT IS NO LONGER ANYBODY'S UNSENT TEXT — the ones
 *  the record TOOK. All three of a question's keys go together (its pick,
 *  its words, and the mark that says it was seeded), which is why the
 *  spelling of them lives here rather than at the form that sends.
 *
 *  A question the record did not take keeps everything: a person who filled
 *  in three of four questions and pressed Answer still has the fourth in
 *  front of them, with whatever they had started typing in it. */
export function forgetAskFields(
  ask: string,
  fields: ReadonlyArray<string>,
): void {
  dropAskFields(
    ask,
    fields.flatMap((field) => [field, typedKey(field), seededKey(field)]),
  );
}
