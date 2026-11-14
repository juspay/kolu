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
 *  ONE QUESTION, ONE ANSWER. For a single-answer question the options and the
 *  box beside them are two halves of the same question: typing replaces the
 *  pick and picking replaces the words. A `multiple` question is a list by
 *  definition and keeps both.
 *
 *  Drafts are kept per ask (`./drafts`), so half-filling a form, opening the
 *  plan and coming back does not lose the pick — and the draft is shared by
 *  every face, because they are one question.
 */

import type { Decision, Work } from "kolu-work";
import { type Component, For, Show, batch, createMemo } from "solid-js";
import { askDraft, forgetAskDraft, setAskDraft } from "./drafts";
import { answerWords } from "./workReadings";
import { openReader } from "./reader/useReader";
import { useConductor } from "./useConductor";

/** One option chip. The SELECTED state is layered on through `classList`, so
 *  the shape of a chip is written once and only the two colours branch. */
const OPTION_CLASS = "rounded-md border px-2.5 py-1 text-fg cursor-pointer";

/** The free-text half of a question, under its own key beside the decision's
 *  — `~` because a decision id is a uuid and never contains one. */
const typedKey = (decision: string): string => `${decision}~typed`;

/** WHAT TO CALL THE BUTTON THAT OPENS THE FILE. The plan is the file this
 *  exists for, so it is named rather than described; anything else is read by
 *  its own basename, which is what a person would call it. */
const readWords = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === "plan.md" ? "Read the plan" : `Read ${name}`;
};

const WorkQuestion: Component<{
  work: Work;
  /** The ask to draw — one form, however many questions it carries. */
  ask: string;
  /** WHICH FACE this copy is. The decision records it, which is the only
   *  thing that tells the four apart afterwards. */
  from: "card" | "chat" | "reader" | "popout";
  /** What the reader has to send WITH the answer: the comments a person left
   *  on the file. Appended to whatever they typed, and counted on screen so
   *  nothing travels invisibly. */
  attach?: { count: number; text: () => string };
}> = (props) => {
  const orch = useConductor();
  /** The questions of this ask, in the order they were asked. A question the
   *  REQUEST answered is not drawn: nobody is asked what they already said. */
  const questions = createMemo(() =>
    props.work.decisions.filter(
      (one) => one.ask === props.ask && one.answer?.from !== "request",
    ),
  );
  const open = createMemo(() =>
    questions().filter((one) => one.answer === null),
  );
  const settled = () => open().length === 0;

  const picked = (decision: string, value: string): boolean =>
    askDraft(props.ask, decision).includes(value);

  /** An option pressed. A single-answer question keeps the one pressed last
   *  and empties its box; a `multiple` question toggles. */
  const pick = (decision: Decision, value: string): void => {
    const current = askDraft(props.ask, decision.id);
    if (decision.multiple) {
      setAskDraft(
        props.ask,
        decision.id,
        current.includes(value)
          ? current.filter((one) => one !== value)
          : [...current, value],
      );
      return;
    }
    batch(() => {
      setAskDraft(props.ask, decision.id, [value]);
      setAskDraft(props.ask, typedKey(decision.id), []);
    });
  };

  /** Words typed beside the options. The first character of an own answer to
   *  a single-answer question drops the pick, as you watch. */
  const type = (decision: Decision, text: string): void =>
    batch(() => {
      setAskDraft(props.ask, typedKey(decision.id), text === "" ? [] : [text]);
      if (text !== "" && !decision.multiple)
        setAskDraft(props.ask, decision.id, []);
    });

  /** WHAT IS SENT, per decision: what they picked, plus what they typed —
   *  and, from the reader, the comments that go with the answer appended to
   *  those words. A question they left alone sends nothing, and the record
   *  says exactly that about it. */
  const answers = (): Record<string, ReadonlyArray<string>> => {
    const sending: Record<string, ReadonlyArray<string>> = {};
    const rider = props.attach?.text() ?? "";
    for (const decision of open()) {
      const chosen = askDraft(props.ask, decision.id);
      const typed = askDraft(props.ask, typedKey(decision.id))[0] ?? "";
      const words = [typed, rider].filter((one) => one !== "").join("\n\n");
      const values = [...chosen, ...(words === "" ? [] : [words])];
      if (values.length > 0) sending[decision.id] = values;
    }
    return sending;
  };

  const send = (values: Record<string, ReadonlyArray<string>> | null): void => {
    orch.answerWork(props.work.id, props.ask, values, props.from);
    forgetAskDraft(props.ask);
  };

  return (
    <section
      data-testid="work-question"
      data-ask={props.ask}
      data-from={props.from}
      data-settled={settled() ? "" : undefined}
      class="rounded-xl border border-alert/55 bg-alert/[0.08] px-3 py-2.5 text-xs"
    >
      <header class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 mb-1">
        <span class="text-alert text-base leading-none">✱</span>
        <b class="text-[0.78rem]">Conductor asks you</b>
        {/* WHICH WORK IT IS ABOUT — never on the card, which already is the
            work, and always everywhere else, where questions from several
            pieces of work land in one place. */}
        <Show when={props.from !== "card"}>
          <span
            data-testid="work-question-work"
            class="min-w-0 truncate font-mono text-[0.62rem] text-fg-3"
          >
            about “{props.work.title}”
          </span>
        </Show>
      </header>

      <Show
        when={!settled()}
        fallback={
          <ul class="mt-2 list-none m-0 p-0 flex flex-col gap-0.5">
            {/* THE RECORD: what was asked and what was said, one line each —
                drawn for every ending, so a declined or dropped question
                lists its questions with how they ended instead, which is
                exactly what happened to them. */}
            <For each={questions()}>
              {(decision) => (
                <li
                  data-testid="conductor-ask-answer"
                  data-field={decision.id}
                  class="text-fg-2"
                >
                  <span class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                    {decision.header === ""
                      ? decision.question
                      : decision.header}
                  </span>
                  <span class="text-fg"> — {answerWords(decision)}</span>
                </li>
              )}
            </For>
          </ul>
        }
      >
        <For each={open()}>
          {(decision) => (
            <fieldset class="mt-2" data-decision={decision.id}>
              <legend class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                {decision.question}
              </legend>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <For each={decision.options}>
                  {(option) => {
                    const on = () => picked(decision.id, option);
                    return (
                      <button
                        type="button"
                        data-testid="conductor-ask-option"
                        data-field={decision.id}
                        data-value={option}
                        data-active={on() ? "" : undefined}
                        class={OPTION_CLASS}
                        classList={{
                          "border-accent bg-accent/15": on(),
                          "border-edge-bright bg-surface-2": !on(),
                        }}
                        onClick={() => pick(decision, option)}
                      >
                        {option}
                      </button>
                    );
                  }}
                </For>
              </div>
              <input
                type="text"
                data-testid="conductor-ask-other"
                data-field={decision.id}
                placeholder="or say it in your own words"
                value={askDraft(props.ask, typedKey(decision.id))[0] ?? ""}
                class="mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent"
                onInput={(event) => type(decision, event.currentTarget.value)}
              />
              {/* THE ONE THING THEY MUST READ BEFORE ANSWERING. Offered where
                  the reader is not already open — in the reader itself the
                  file IS on screen, and a button to open what you are looking
                  at is noise. */}
              <Show
                when={
                  decision.file !== "" &&
                  (props.from === "card" || props.from === "chat")
                }
              >
                <button
                  type="button"
                  data-testid="work-question-read"
                  data-path={decision.file}
                  class="mt-1.5 rounded-md border border-edge-bright px-2.5 py-1 text-fg-2 hover:text-fg cursor-pointer"
                  onClick={() =>
                    openReader({ work: props.work.id, path: decision.file })
                  }
                >
                  {readWords(decision.file)}
                </button>
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
            class="rounded-md bg-accent px-3 py-1 font-semibold text-surface-0 cursor-pointer"
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
            onClick={() => send(null)}
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
