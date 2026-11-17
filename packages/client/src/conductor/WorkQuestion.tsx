/** KOLU'S OWN QUESTION ABOUT A PIECE OF WORK, drawn wherever a person is.
 *
 *  THE RECORD IS THE FORM. A question about a work is a DECISION on that work
 *  with no answer yet — not a call somebody is holding open — so this draws
 *  straight off the work's own decisions and answers through
 *  `conductor.answerWork`. That is what lets the same question be answered
 *  from the card, from the chat, from the reader a plan is open in, or from
 *  that reader popped out into a window of its own: four faces, one decision,
 *  and whichever one answers settles it.
 *
 *  It is also what lets a person take their time. Nothing is waiting on them:
 *  the Conductor was told its question had been put and ended its turn, and
 *  the answer reaches it as a wake whenever it comes — ten seconds or an hour
 *  later, across a restart, across a "New session".
 *
 *  A FORM MAY BE ANSWERED IN PARTS. An ask is as many questions as its asker
 *  put in it, and pressing Answer records the ones that were FILLED IN: the
 *  blank ones stay asked, in the same ask, and this form keeps drawing them
 *  with what was already said listed above them. So the three questions a
 *  person could answer are answered now, and the fourth — the model whose
 *  list has not arrived, the plan they have not read yet — is still there
 *  when they can. Answer is dead while nothing at all is filled in: a press
 *  that would record nothing is not offered.
 *
 *  ONE QUESTION, ONE ANSWER. For a single-answer question the options and the
 *  box beside them are two halves of the same question: typing replaces the
 *  pick and picking replaces the words. A `multiple` question is a list by
 *  definition and keeps both.
 *
 *  KOLU'S OWN WORDS, FOR KOLU'S OWN QUESTIONS. The mode and what to do on
 *  green are answered from their options and from nowhere else — their
 *  answers are a vocabulary the record and the start command both read, and
 *  an answer outside it is refused where it is recorded. So those two draw no
 *  box to type in. A question ABOUT THE WORK is the asker's own and keeps
 *  one: its answer is words.
 *
 *  WHOSE OPTIONS THEY ARE. Most questions are drawn from the options their
 *  asker gave. The four setup questions about a role's harness and its model
 *  are not: nobody but kolu knows which agents this build carries or which
 *  models the work's host offers, so those are drawn by
 *  {@link WorkChoiceQuestion}, from the listing and from that host's own
 *  answer, live.
 *
 *  WHAT YOU CHOSE LAST TIME IS ALREADY CHOSEN. Every setup question opens on
 *  this person's last answer on this host, read off the SAVED works
 *  (`setupMemory`) rather than off a conversation — so a new conversation, a
 *  restart and a second tab all offer the same thing — drawn first and
 *  selected, which means one press of Answer sends the whole setup. It is
 *  written into the draft once ({@link seededChips}), which is what keeps
 *  "nobody has touched this" and "they took the pick off" apart.
 *
 *  Drafts are kept per ask (`./drafts`), so half-filling a form, opening the
 *  plan and coming back does not lose the pick — and the draft is shared by
 *  every face, because they are one question. What a press of Answer forgets
 *  is exactly what the record TOOK ({@link forgetAskFields}): a question the
 *  record left open keeps the words that were in it.
 */

import { Option } from "effect";
import {
  type AnsweredFromFace,
  type Asked,
  hostOf,
  isAsked,
  isKoluChoice,
  isSettled,
  type Offered,
  type Recalled,
  type SentAnswer,
  setupMemory,
  type Work,
  type WorkId,
} from "kolu-work";
import { type Component, createMemo, For, Show } from "solid-js";
import { useShown } from "../ui/shown";
import AskOptions, { askOption } from "./AskOptions";
import {
  forgetAskFields,
  pickOnly,
  seededChips,
  typedKey,
  typeOnly,
} from "./askForm";
import { askDraft, forgetAskDraft, setAskDraft } from "./drafts";
import { askOnScreenKey, trackOnScreen } from "./onScreen";
import { openReader } from "./reader/useReader";
import { useConductor } from "./useConductor";
import { useWorkMap } from "./useWorks";
import WorkChip from "./WorkChip";
import WorkChipFace from "./WorkChipFace";
import WorkChoiceQuestion from "./WorkChoiceQuestion";
import { workFileName } from "./workFile";
import { answerWords, decisionLabel } from "./workReadings";

/** WHAT TO CALL THE BUTTON THAT OPENS THE FILE. The plan is the file this
 *  exists for, so it is named rather than described; anything else is read by
 *  the name every face of a work says it by ({@link workFileName}). */
const readWords = (path: string): string => {
  const name = workFileName(path);
  return name === "plan.md" ? "Read the plan" : `Read ${name}`;
};

/** Whether this question takes more than one answer — a fact of a question
 *  ABOUT THE WORK alone: the setup's own questions each take one value, by
 *  type, so there is nowhere on them to say otherwise. */
const takesSeveral = (decision: Offered): boolean =>
  decision.topic === "work" && decision.multiple;

const WorkQuestion: Component<{
  work: Work;
  /** The id the work is filed under — what answering it names. */
  id: WorkId;
  /** The ask to draw — one form, however many questions it carries. */
  ask: string;
  /** WHICH FACE this copy is. The vocabulary is the record's own
   *  ({@link AnsweredFromFace}): `request` is not a face a browser may claim,
   *  and the decision records which of the four it was, which is the only
   *  thing that tells them apart afterwards. */
  from: AnsweredFromFace;
  /** What the reader has to send WITH the answer: the comments a person left
   *  on the file. Appended to whatever they typed, and counted on screen so
   *  nothing travels invisibly. */
  attach?: { count: number; text: () => string };
}> = (props) => {
  const orch = useConductor();
  // IN VIEW, WHEREVER IT IS DRAWN — on the card, in the chat, in the reader:
  // a question a person can see in a focused window does not ring.
  const track = trackOnScreen(() => askOnScreenKey(props.ask), useShown());
  /** The questions of this ask, in the order they were asked. A question the
   *  REQUEST answered is not drawn: nobody is asked what they already said. */
  const questions = createMemo(() =>
    props.work.decisions.filter(
      (one) =>
        one.ask === props.ask &&
        !(
          isSettled(one) &&
          one.answer.how !== "dropped" &&
          one.answer.from === "request"
        ),
    ),
  );
  /** The ones still asked — the fields — and the ones already settled, which
   *  are drawn as the record of what was said ABOVE them. A form answered in
   *  parts is both at once. */
  const open = createMemo(() => questions().filter((one) => isAsked(one)));
  const recorded = createMemo(() =>
    questions().filter((one) => isSettled(one)),
  );
  const settled = () => open().length === 0;

  /** WHAT THIS PERSON CHOSE BEFORE on this work's host, off the saved works.
   *  Read by every setup question in the form — the two drawn here and the
   *  four {@link WorkChoiceQuestion} draws — so the mirror is folded once. */
  const works = useWorkMap();
  const memory = createMemo(() =>
    setupMemory([...works().values()], hostOf(props.work)),
  );

  const picked = (decision: string, value: string): boolean =>
    askDraft(props.ask, decision).includes(value);

  /** An option pressed. A single-answer question keeps the one pressed last
   *  and empties its box; a `multiple` question toggles. */
  const pick = (decision: Offered, value: string): void => {
    const current = askDraft(props.ask, decision.id);
    if (takesSeveral(decision)) {
      setAskDraft(
        props.ask,
        decision.id,
        current.includes(value)
          ? current.filter((one) => one !== value)
          : [...current, value],
      );
      return;
    }
    pickOnly(props.ask, decision.id, value);
  };

  /** Words typed beside the options. The first character of an own answer to
   *  a single-answer question drops the pick, as you watch. */
  const type = (decision: Offered, text: string): void => {
    if (!takesSeveral(decision)) {
      typeOnly(props.ask, decision.id, text);
      return;
    }
    setAskDraft(props.ask, typedKey(decision.id), text === "" ? [] : [text]);
  };

  /** A QUESTION ITS ASKER DREW THE OPTIONS FOR: the options with what this
   *  person chose last time first and already in the draft, and — for a
   *  question about the work, whose answer is words — the box beside them.
   *  The options are known the moment the form is drawn, so the default seeds
   *  on the first frame and never again. */
  const OfferedQuestion: Component<{ decision: Offered }> = (one) => {
    /** The last answer, when it is one of the options drawn here. A question
     *  about the work has no last time to open on: it is this work's own
     *  question, asked once. */
    const standing = (): Option.Option<Recalled> => {
      const decision = one.decision;
      if (decision.topic !== "setup") return Option.none();
      return Option.filter(memory().last(decision.key, Option.none()), (want) =>
        (decision.options as ReadonlyArray<string>).includes(want.value),
      );
    };
    const chips = seededChips(
      props.ask,
      one.decision.id,
      () =>
        one.decision.topic === "setup" ? Option.some("offered") : Option.none(),
      () => one.decision.options.map(askOption),
      standing,
    );
    return (
      <>
        <AskOptions
          field={one.decision.id}
          options={chips()}
          usedBefore={Option.match(standing(), {
            onSome: (last) => [last.value],
            onNone: () => [],
          })}
          picked={(value) => picked(one.decision.id, value)}
          onPick={(value) => pick(one.decision, value)}
          searchLabel="options"
        />
        {/* THE BOX IS FOR QUESTIONS ABOUT THE WORK. The mode and what to do
            on green are answered in kolu's own words — the record takes no
            other, and the start command reads them back — so offering a box
            there would be offering an answer that is refused. */}
        <Show when={one.decision.topic === "work"}>
          <input
            type="text"
            data-testid="conductor-ask-other"
            data-field={one.decision.id}
            placeholder="or say it in your own words"
            value={askDraft(props.ask, typedKey(one.decision.id))[0] ?? ""}
            class="mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent"
            onInput={(event) => type(one.decision, event.currentTarget.value)}
          />
        </Show>
      </>
    );
  };

  /** WHAT ONE QUESTION SENDS: what they picked, plus what they typed — and,
   *  from the reader, the comments that go with the answer appended to those
   *  words. None is a question they left alone, which is sent as nothing at
   *  all and STAYS ASKED.
   *
   *  A setup question sends EXACTLY ONE value and no rider: its answer is one
   *  of kolu's words (or, for a harness or a model, one name). A model the
   *  person TYPED is sent as typed — the record keeps how it was chosen, and
   *  a typed model is never held to the host's list. */
  const sentOf = (
    decision: Asked,
    rider: string,
  ): Option.Option<SentAnswer> => {
    const chosen = askDraft(props.ask, decision.id);
    const typed = askDraft(props.ask, typedKey(decision.id))[0] ?? "";
    switch (decision.topic) {
      case "setup": {
        // Only a question kolu drew the options for takes a typed answer.
        if (isKoluChoice(decision) && typed.trim() !== "")
          return Option.some({ typed: typed.trim() });
        const one = chosen[0];
        return one === undefined || one === ""
          ? Option.none()
          : Option.some([one]);
      }
      case "work": {
        const words = [typed, rider].filter((part) => part !== "").join("\n\n");
        const values = [...chosen, ...(words === "" ? [] : [words])];
        return values.length === 0 ? Option.none() : Option.some(values);
      }
      default:
        return decision satisfies never;
    }
  };

  /** The whole form, as it is sent: only the questions that have something in
   *  them. */
  const answers = createMemo((): Record<string, SentAnswer> => {
    const sending: Record<string, SentAnswer> = {};
    const rider = props.attach?.text() ?? "";
    for (const decision of open()) {
      const sent = sentOf(decision, rider);
      if (Option.isSome(sent)) sending[decision.id] = sent.value;
    }
    return sending;
  });

  /** NOTHING FILLED IN IS NOTHING TO SEND — the one rule the Answer button
   *  is dead by. */
  const filled = () => Object.keys(answers()).length > 0;

  /** ANSWER. What the record TOOK is forgotten; what it left open keeps its
   *  draft, so a question whose value the record would not take is still
   *  there with the words that were in it. */
  const send = (values: Record<string, SentAnswer>): void => {
    const sent = Object.keys(values);
    orch.answerWork(props.id, props.ask, values, props.from, (outcome) => {
      switch (outcome.kind) {
        case "answered":
        case "declined":
          forgetAskDraft(props.ask);
          return;
        case "part":
          forgetAskFields(
            props.ask,
            sent.filter((id) => !outcome.open.includes(id)),
          );
          return;
        // The record took nothing — another face got there first, or none of
        // it was still open. Everything stays where it is.
        case "nothing-open":
          return;
        default:
          return outcome satisfies never;
      }
    });
  };

  /** DECLINE, which settles every question still open in this ask — so the
   *  whole of the form's draft goes with it. */
  const decline = (): void => {
    orch.answerWork(props.id, props.ask, null, props.from);
    forgetAskDraft(props.ask);
  };

  return (
    <section
      ref={track}
      data-testid="work-question"
      data-ask={props.ask}
      data-from={props.from}
      data-settled={settled() ? "" : undefined}
      class="rounded-xl border border-alert/55 bg-alert/[0.08] px-3 py-2.5 text-xs"
    >
      <header class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
        <span class="text-alert text-base leading-none">✱</span>
        <b class="text-[0.78rem]">Conductor asks you</b>
        {/* WHICH WORK IT IS ABOUT, as the chip every other face names a work
            with — never on the card, which already is the work. In the chat
            it is the chip that brings the card; in a reader, whose header
            already carries that chip, it is the same face, not pressed. */}
        <Show when={props.from !== "card"}>
          <span data-testid="work-question-work" class="min-w-0">
            <Show
              when={props.from === "chat"}
              fallback={<WorkChipFace work={props.work} />}
            >
              <WorkChip id={props.id} work={props.work} />
            </Show>
          </span>
        </Show>
      </header>

      {/* THE RECORD: what was asked and what was said, one line each — drawn
          for every ending, so a declined or dropped question lists how it
          ended instead, which is exactly what happened to it. It sits ABOVE
          the fields, because in a form answered in parts these are the
          questions that are already behind the person. */}
      <Show when={recorded().length > 0}>
        <ul class="mt-2 list-none m-0 p-0 flex flex-col gap-0.5">
          <For each={recorded()}>
            {(decision) => (
              <li
                data-testid="conductor-ask-answer"
                data-field={decision.id}
                class="text-fg-2"
              >
                <span class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                  {decisionLabel(decision)}
                </span>
                <span class="text-fg"> — {answerWords(decision)}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={!settled()}>
        <For each={open()}>
          {(decision) => (
            <fieldset class="mt-2" data-decision={decision.id}>
              <legend class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                {decision.question}
              </legend>
              {/* WHOSE QUESTION THIS IS, branched once: a decision is one
                  shape or the other for as long as it exists. */}
              {isKoluChoice(decision) ? (
                <WorkChoiceQuestion
                  work={props.work}
                  ask={props.ask}
                  decision={decision}
                  memory={memory()}
                />
              ) : (
                <OfferedQuestion decision={decision} />
              )}
              {/* THE ONE THING THEY MUST READ BEFORE ANSWERING. Offered
                  where the reader is not already open — in the reader
                  itself the file IS on screen, and a button to open what
                  you are looking at is noise. */}
              <Show
                when={
                  decision.topic === "work" &&
                  decision.file.kind === "file" &&
                  (props.from === "card" || props.from === "chat")
                    ? decision.file.path
                    : undefined
                }
              >
                {(path) => (
                  <button
                    type="button"
                    data-testid="work-question-read"
                    data-path={path()}
                    class="mt-1.5 rounded-md border border-edge-bright px-2.5 py-1 text-fg-2 hover:text-fg cursor-pointer"
                    onClick={() => openReader({ work: props.id, path: path() })}
                  >
                    {readWords(path())}
                  </button>
                )}
              </Show>
            </fieldset>
          )}
        </For>

        {/* WHAT TRAVELS WITH THE ANSWER, said out loud: comments left on the
            file are appended to the words, and a person must know that before
            they press. */}
        <Show when={(props.attach?.count ?? 0) > 0}>
          <p
            data-testid="work-question-attach"
            class="mt-2 m-0 font-mono text-[0.62rem] text-fg-3"
          >
            {props.attach?.count === 1
              ? "1 comment goes with your answer"
              : `${props.attach?.count} comments go with your answer`}
          </p>
        </Show>

        <div class="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="conductor-ask-submit"
            // DEAD WHILE THERE IS NOTHING TO RECORD. A press that answered
            // nothing used to read as an answer; now the button says before
            // the press that there is nothing in the form yet.
            disabled={!filled()}
            class="rounded-md bg-accent px-3 py-1 font-semibold text-surface-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => send(answers())}
          >
            Answer
          </button>
          <button
            type="button"
            data-testid="conductor-ask-dismiss"
            class="rounded-md border border-edge-bright px-3 py-1 text-fg-2 hover:text-fg cursor-pointer"
            // DECLINE, not a silent close: the Conductor is told you would not
            // say, never handed a choice you did not make.
            onClick={decline}
          >
            I'd rather not say
          </button>
        </div>
      </Show>
    </section>
  );
};

export default WorkQuestion;
export { WorkQuestion };
