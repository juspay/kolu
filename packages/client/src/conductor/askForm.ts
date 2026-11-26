/** ONE ASK'S FORM, as the draft holds it — the keys a question keeps beside
 *  its own, the single-answer behaviour every face shares, and THE RULE THAT
 *  TELLS AN UNTOUCHED QUESTION FROM A CLEARED ONE.
 *
 *  WHY A DEFAULT AT ALL. A setup question opens with what this person chose
 *  last time on this host ({@link SetupMemory}), already selected, so that
 *  with nothing changed one press of Answer sends the whole setup. "Already
 *  selected" has to be the ANSWER and not a highlight: `answers()` reads the
 *  form through {@link draftOf}, so the default travels exactly as a pick
 *  does and nothing remembers a second kind of selection.
 *
 *  IT IS READ, NOT WRITTEN. The draft holds what a person did, and nothing
 *  else: a question with NO ENTRY is one nobody has touched, and an entry of
 *  no values is one they cleared on purpose. That distinction is the whole
 *  reason the default cannot be written into the draft — a write makes the
 *  two look alike a flush later, and the writer has to carry a mark saying
 *  which it was. Reading through the default keeps them apart for free.
 *
 *  THE DEFAULT IS A DERIVATION, PUBLISHED BY THE QUESTION THAT CAN SAY IT.
 *  What this person may answer with here is a fact about the options drawn —
 *  and, for a model, about the harness answered beside it and what the host
 *  says that harness offers, which only the question drawing it knows and
 *  which changes while the form is open. So the question publishes the
 *  derivation ({@link offerAskDefault}, for as long as it is drawn) and every
 *  reader — the chips, the box, and the Answer button's fold — asks it. A
 *  model question therefore follows the harness beside it in the same flush
 *  the harness is pressed in, instead of being re-seeded one flush later.
 *
 *  The default is shared by the four faces exactly as the pick is, because
 *  the ask id and the field are its address — a form half-filled on the card
 *  and finished in the reader opens on the same values.
 */

import { Option } from "effect";
import type { Recalled } from "kolu-work";
import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { type AskOption, defaultFirst } from "./AskOptions";
import { askDraftEntry, dropAskFields, setAskDraft } from "./drafts";

/** The free-text half of a question, under its own key beside the decision's
 *  — `~` because a decision id is a uuid and never contains one. */
export const typedKey = (decision: string): string => `${decision}~typed`;

/** A QUESTION'S DEFAULT, BOXED: `createSignal`'s function form is a writable
 *  memo, so a derivation has to be carried as a value. */
interface Standing {
  readonly of: () => Option.Option<Recalled>;
  /** The publication it came from. The same ask is drawn by four faces at
   *  once, and a question re-drawn around a new offer replaces its own
   *  entry — the one that was replaced must not take the new one away when
   *  it is disposed. */
  readonly seq: number;
}

/** THE DEFAULT EACH QUESTION ON SCREEN OPENS ON, by ask and field — the
 *  DERIVATION and not a copy of its answer, so a reader is in the same flush
 *  as the question's own readers: calling `of()` from a memo subscribes that
 *  memo to the options, the harness answered beside it and the host's list,
 *  exactly as the question itself is subscribed. A relayed VALUE would put
 *  the Answer button a flush behind the chips.
 *
 *  `ownedWrite`: a question publishes from its body, the way the peek window
 *  hands up its typing derivation (`peek/usePeek.ts`). A form holds a handful
 *  of questions, so the map is replaced whole: the moments it changes are the
 *  moments the form itself is being built or taken down. */
const [standings, setStandings] = createSignal<ReadonlyMap<string, Standing>>(
  new Map(),
  { ownedWrite: true },
);

let published = 0;

/** One question's address: its form and its field. A decision id is a uuid
 *  and an ask id a row id, so neither carries a NUL. */
const atKey = (ask: string, field: string): string => `${ask}\u0000${field}`;

/** PUBLISH THIS QUESTION'S DEFAULT for as long as it is drawn — called from
 *  the question's own body, so the derivation arrives with the first frame
 *  and leaves when the question does. */
function offerAskDefault(
  at: string,
  standing: () => Option.Option<Recalled>,
): void {
  const seq = ++published;
  setStandings((all) => new Map(all).set(at, { of: standing, seq }));
  onCleanup(() =>
    setStandings((all) => {
      if (all.get(at)?.seq !== seq) return all;
      const rest = new Map(all);
      rest.delete(at);
      return rest;
    }),
  );
}

/** The default as values of the kind asked for: a default that was PICKED is
 *  the pick, one that was TYPED is the words in the box, and neither is the
 *  other. None when no question is publishing one. */
function defaultOf(
  ask: string,
  field: string,
  chosen: Recalled["chosen"],
): ReadonlyArray<string> {
  const entry = standings().get(atKey(ask, field));
  if (entry === undefined) return [];
  return Option.toArray(
    Option.map(
      Option.filter(entry.of(), (one) => one.chosen === chosen),
      (one) => one.value,
    ),
  );
}

/** WHAT A QUESTION'S PICK IS: what this person chose in this form, or — while
 *  nobody has touched it — the default it opens on. A field they CLEARED has
 *  an entry of no values, which is not untouched and is not defaulted. */
export function draftOf(ask: string, field: string): ReadonlyArray<string> {
  return askDraftEntry(ask, field) ?? defaultOf(ask, field, "picked");
}

/** ... and the words in its box, the same way: a default that was typed goes
 *  back in the box, so it is sent as typed again. */
export function typedDraftOf(
  ask: string,
  field: string,
): ReadonlyArray<string> {
  return askDraftEntry(ask, typedKey(field)) ?? defaultOf(ask, field, "typed");
}

/** An option pressed on a SINGLE-answer question: it keeps the one pressed
 *  last and empties the box beside it — the options and the box are two
 *  halves of one question. Both keys are written, so the question is touched
 *  whichever half the answer ends up in. */
export function pickOnly(ask: string, field: string, value: string): void {
  setAskDraft(ask, field, [value]);
  setAskDraft(ask, typedKey(field), []);
}

/** Words typed beside a single-answer question's options. The first character
 *  of an own answer drops the pick, as you watch. */
export function typeOnly(ask: string, field: string, text: string): void {
  setAskDraft(ask, typedKey(field), text === "" ? [] : [text]);
  if (text !== "") setAskDraft(ask, field, []);
}

/** DEFAULT FIRST, AND THE DEFAULT ITSELF — the whole of how a question opens
 *  on what this person chose last time, in one place because every form does
 *  both halves or neither: the default leads the options drawn ({@link
 *  defaultFirst}), and the same derivation is what the draft is read through
 *  ({@link draftOf}).
 *
 *  A standing answer of NONE is a question with no default to open on — the
 *  options have not arrived, or this question has no memory behind it — and
 *  the question reads as untouched until somebody touches it. */
export function seededChips(
  ask: () => string,
  field: () => string,
  options: () => ReadonlyArray<AskOption>,
  standing: () => Option.Option<Recalled>,
): Accessor<ReadonlyArray<AskOption>> {
  // THE ADDRESS IS READ ONCE: one drawn question is one field of one form for
  // as long as it is on screen, so the key is this component's identity
  // rather than something to follow.
  offerAskDefault(
    untrack(() => atKey(ask(), field())),
    standing,
  );
  return createMemo(
    () =>
      defaultFirst(
        options(),
        Option.map(standing(), (one) => one.value),
      ),
    { name: "seededChips" },
  );
}

/** THE QUESTIONS WHOSE DRAFT IS NO LONGER ANYBODY'S UNSENT TEXT — the ones
 *  the record TOOK, and the model question whose harness has just changed
 *  under it. Both of a question's keys go together (its pick and its words),
 *  which is why the spelling of them lives here rather than at the form that
 *  sends.
 *
 *  A question the record did not take keeps everything: a person who filled
 *  in three of four questions and pressed Answer still has the fourth in
 *  front of them, with whatever they had started typing in it. A question
 *  emptied this way is UNTOUCHED again, so it opens on whatever it now
 *  defaults to. */
export function forgetAskFields(
  ask: string,
  fields: ReadonlyArray<string>,
): void {
  dropAskFields(
    ask,
    fields.flatMap((field) => [field, typedKey(field)]),
  );
}
