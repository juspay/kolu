/** The agent asking a PERSON something, as a form in the transcript.
 *
 *  Inline rather than a modal: a question is part of the conversation, and
 *  whatever the agent said before it is the context for answering. A question
 *  NEVER times out, so the form has no deadline and no implied default — the
 *  two buttons are *answer with what I picked* and *I would not say*, and the
 *  second one tells the agent exactly that rather than fabricating a choice.
 *
 *  ANSWERING DOES NOT ERASE IT. A settled card keeps reading as what it was —
 *  every question, with what was said to it on its line ({@link ./askRecord})
 *  — and adds how it ended. The card that collapsed to the bare word
 *  `answered` threw away both halves of the exchange a day later.
 *
 *  Drafts are kept per question (`./drafts`), so half-filling one form, scrolling
 *  away, and coming back does not lose the pick. They are dropped the moment the
 *  question stops waiting.
 *
 *  The field kinds come from `@kolu/acp`'s projection of the agent's JSON
 *  Schema — a browser never reads a `oneOf`. An `attachedTo` field is the
 *  free-text "other" for the field it names, drawn inside that field's block
 *  rather than as a question of its own.
 *
 *  ONE QUESTION, ONE ANSWER. For a single-choice question, the chips and the
 *  "Other" box beside them are two halves of the SAME question: typing your
 *  own words replaces the pick, and picking replaces the words. The card that
 *  read `IMPL HARNESS — OpenCode · omp` — an option pressed AND a name typed —
 *  told the agent two things and made it ask again. A `choices` question is a
 *  list by definition and keeps both. */

import {
  type AskAnswer,
  type AskField,
  type ConductorAskRow,
  YES_NO,
} from "kolu-common/conductor";
import {
  batch,
  type Component,
  createMemo,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { askLead, askQuestions, askRecord } from "./askRecord";
import { askDraft, forgetAskDraft, setAskDraft } from "./drafts";
import { useConductor } from "./useConductor";

/** One option chip. The SELECTED state is layered on through `classList`, so
 *  the shape of a chip is written once and only the two colours branch. */
const OPTION_CLASS = "rounded-md border px-2.5 py-1 text-fg cursor-pointer";

/** Does this question hold exactly ONE answer? A `choice` offers one of its
 *  options and a `boolean` is yes or no; only `choices` is a list. The "Other"
 *  box attached to such a question is an alternative to its chips, never an
 *  addition to them. */
const singleAnswer = (field: AskField): boolean =>
  field.kind === "choice" || field.kind === "boolean";

const ConductorAsk: Component<{ row: ConductorAskRow }> = (props) => {
  const orch = useConductor();
  const ask = () => props.row.ask;
  const settled = () => ask().outcome !== null;
  /** The fields that are questions in their own right — an `attachedTo` field
   *  belongs inside the block of the field it extends. */
  const questions = createMemo(() => askQuestions(props.row));
  const otherFor = (key: string) =>
    ask().fields.find((field) => field.attachedTo === key);
  /** Is this value in the draft for this field — the one predicate every
   *  option chip asks, of itself, to colour and mark itself. */
  const picked = (key: string, value: string): boolean =>
    askDraft(props.row.id, key).includes(value);

  /**
   * WHAT IS SENT, derived from the draft in one place.
   *
   * The writers below already clear the other half as you act, so the form in
   * front of you can only hold one of the two. This derivation is what makes
   * that a property of the ANSWER rather than of the clicking: a draft that
   * somehow held both — restored from an older store, written by a future
   * caller — still sends one, and it sends the typed words, because they are
   * the answer the options could not express.
   */
  const answers = (): AskAnswer[] => {
    const replaced = new Set<string>();
    for (const field of ask().fields) {
      if (field.attachedTo === null) continue;
      if (askDraft(props.row.id, field.key).length === 0) continue;
      const asked = ask().fields.find((one) => one.key === field.attachedTo);
      if (asked !== undefined && singleAnswer(asked)) replaced.add(asked.key);
    }
    return ask()
      .fields.map((field) => ({
        key: field.key,
        values: replaced.has(field.key)
          ? []
          : [...askDraft(props.row.id, field.key)],
      }))
      .filter((answer) => answer.values.length > 0);
  };

  const submit = (): void => {
    orch.answer(props.row.id, answers());
    forgetAskDraft(props.row.id);
  };

  /** An option pressed. A single-answer question keeps the one pressed last
   *  and empties its "Other" box; a `choices` question toggles. */
  const pick = (field: AskField, value: string): void => {
    const current = askDraft(props.row.id, field.key);
    if (!singleAnswer(field)) {
      setAskDraft(
        props.row.id,
        field.key,
        current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      );
      return;
    }
    const other = otherFor(field.key);
    batch(() => {
      setAskDraft(props.row.id, field.key, [value]);
      if (other !== undefined) setAskDraft(props.row.id, other.key, []);
    });
  };

  /** Words typed into a question's "Other" box. The first character of an own
   *  answer to a single-answer question drops the pick — one question, one
   *  answer, and the chips go back to unselected as you watch. */
  const typeOther = (asked: AskField, other: AskField, text: string): void =>
    batch(() => {
      setAskDraft(props.row.id, other.key, text === "" ? [] : [text]);
      if (text !== "" && singleAnswer(asked))
        setAskDraft(props.row.id, asked.key, []);
    });

  return (
    <section
      data-testid="conductor-ask"
      data-ask-id={props.row.id}
      data-settled={settled() ? "" : undefined}
      class="rounded-xl border border-alert/55 bg-alert/[0.08] px-3 py-2.5 text-xs"
    >
      <header class="flex items-center gap-2 mb-1">
        <span class="text-alert text-base leading-none">✱</span>
        <b class="text-[0.78rem]">Conductor asks you</b>
      </header>
      {/* The ask's own sentence, only where it says something the fields do
          not — see {@link askLead}. */}
      <Show when={askLead(props.row)}>
        {(lead) => (
          <p
            data-testid="conductor-ask-text"
            class="text-fg whitespace-pre-wrap"
          >
            {lead()}
          </p>
        )}
      </Show>
      <Show when={ask().link}>
        {(link) => (
          <a
            href={link().url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="conductor-ask-link"
            class="mt-1.5 block text-accent hover:underline break-all"
          >
            {link().url} <span class="text-fg-3">· {link().host}</span>
          </a>
        )}
      </Show>
      <Show
        when={!settled()}
        fallback={
          <>
            {/* THE RECORD: what was asked and what was said, one line each.
                Drawn for every ending — a declined or withdrawn form lists its
                questions with nothing beside them, which is exactly what
                happened to them. */}
            <ul class="mt-2 list-none m-0 p-0 flex flex-col gap-0.5">
              <For each={askRecord(props.row)}>
                {(line) => (
                  <li
                    data-testid="conductor-ask-answer"
                    data-field={line.key}
                    class="text-fg-2"
                  >
                    <span class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                      {line.question}
                    </span>
                    <Show when={line.answer}>
                      {(answer) => <span class="text-fg"> — {answer()}</span>}
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <p
              data-testid="conductor-ask-outcome"
              class="mt-2 font-mono text-[0.65rem] text-fg-3"
            >
              {ask().outcome?.how}
            </p>
          </>
        }
      >
        <For each={questions()}>
          {(field) => (
            <fieldset class="mt-2">
              <Show when={field.label}>
                {(label) => (
                  <legend class="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-fg-3">
                    {label()}
                  </legend>
                )}
              </Show>
              <Show when={field.hint}>
                {(hint) => <p class="text-fg-3 text-[0.7rem]">{hint()}</p>}
              </Show>
              <Switch
                fallback={
                  <input
                    type={
                      field.kind === "number" || field.kind === "integer"
                        ? "number"
                        : "text"
                    }
                    data-testid="conductor-ask-input"
                    data-field={field.key}
                    value={askDraft(props.row.id, field.key)[0] ?? ""}
                    class="mt-1 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent"
                    onInput={(event) =>
                      setAskDraft(
                        props.row.id,
                        field.key,
                        event.currentTarget.value === ""
                          ? []
                          : [event.currentTarget.value],
                      )
                    }
                  />
                }
              >
                <Match
                  when={field.kind === "choice" || field.kind === "choices"}
                >
                  <div class="mt-1.5 flex flex-wrap gap-1.5">
                    <For each={field.choices}>
                      {(choice) => {
                        const on = () => picked(field.key, choice.value);
                        return (
                          <button
                            type="button"
                            data-testid="conductor-ask-option"
                            data-field={field.key}
                            data-value={choice.value}
                            data-active={on() ? "" : undefined}
                            title={choice.hint ?? undefined}
                            class={OPTION_CLASS}
                            classList={{
                              "border-accent bg-accent/15": on(),
                              "border-edge-bright bg-surface-2": !on(),
                            }}
                            onClick={() => pick(field, choice.value)}
                          >
                            {choice.label}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Match>
                <Match when={field.kind === "boolean"}>
                  <div class="mt-1.5 flex gap-1.5">
                    <For each={[YES_NO.yes, YES_NO.no]}>
                      {(value) => {
                        const on = () => picked(field.key, value);
                        return (
                          <button
                            type="button"
                            data-testid="conductor-ask-option"
                            data-field={field.key}
                            data-value={value}
                            data-active={on() ? "" : undefined}
                            class={OPTION_CLASS}
                            classList={{
                              "border-accent bg-accent/15": on(),
                              "border-edge-bright bg-surface-2": !on(),
                            }}
                            onClick={() => pick(field, value)}
                          >
                            {value === YES_NO.yes ? "Yes" : "No"}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Match>
              </Switch>
              {/* The CLI's per-question "Other" box, drawn inside the block it
                  extends because that is the question it answers. */}
              <Show when={otherFor(field.key)}>
                {(other) => (
                  <input
                    type="text"
                    data-testid="conductor-ask-other"
                    data-field={other().key}
                    placeholder={other().label ?? "Other…"}
                    value={askDraft(props.row.id, other().key)[0] ?? ""}
                    class="mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent"
                    onInput={(event) =>
                      typeOther(field, other(), event.currentTarget.value)
                    }
                  />
                )}
              </Show>
            </fieldset>
          )}
        </For>
        <div class="mt-2.5 flex gap-2">
          <button
            type="button"
            data-testid="conductor-ask-submit"
            class="rounded-md bg-accent px-3 py-1 font-semibold text-surface-0 cursor-pointer"
            onClick={submit}
          >
            Answer
          </button>
          <button
            type="button"
            data-testid="conductor-ask-dismiss"
            class="rounded-md border border-edge-bright px-3 py-1 text-fg-2 hover:text-fg cursor-pointer"
            // DECLINE, not a silent close: the agent is told you would not say,
            // never handed a choice you did not make.
            onClick={() => {
              orch.answer(props.row.id, null);
              forgetAskDraft(props.row.id);
            }}
          >
            I'd rather not say
          </button>
        </div>
      </Show>
    </section>
  );
};

export default ConductorAsk;
