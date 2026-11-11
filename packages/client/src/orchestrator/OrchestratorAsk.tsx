/** The agent asking a PERSON something, as a form in the transcript.
 *
 *  Inline rather than a modal: a question is part of the conversation, and
 *  whatever the agent said before it is the context for answering. A question
 *  NEVER times out, so the form has no deadline and no implied default — the
 *  two buttons are *answer with what I picked* and *I would not say*, and the
 *  second one tells the agent exactly that rather than fabricating a choice.
 *
 *  Drafts are kept per question (`./drafts`), so half-filling one form, scrolling
 *  away, and coming back does not lose the pick. They are dropped the moment the
 *  question stops waiting.
 *
 *  The field kinds come from `@kolu/acp`'s projection of the agent's JSON
 *  Schema — a browser never reads a `oneOf`. An `attachedTo` field is the
 *  free-text "other" for the field it names, drawn inside that field's block
 *  rather than as a question of its own. */

import {
  type AskAnswer,
  type OrchestratorAskRow,
  YES_NO,
} from "kolu-common/orchestrator";
import { type Component, createMemo, For, Match, Show, Switch } from "solid-js";
import { askDraft, forgetAskDraft, setAskDraft } from "./drafts";
import { useOrchestrator } from "./useOrchestrator";

/** One option chip. The SELECTED state is layered on through `classList`, so
 *  the shape of a chip is written once and only the two colours branch. */
const OPTION_CLASS = "rounded-md border px-2.5 py-1 text-fg cursor-pointer";

const OrchestratorAsk: Component<{ row: OrchestratorAskRow }> = (props) => {
  const orch = useOrchestrator();
  const ask = () => props.row.ask;
  const settled = () => ask().outcome !== null;
  /** The fields that are questions in their own right — an `attachedTo` field
   *  belongs inside the block of the field it extends. */
  const questions = createMemo(() =>
    ask().fields.filter((field) => field.attachedTo === null),
  );
  const otherFor = (key: string) =>
    ask().fields.find((field) => field.attachedTo === key);
  /** Is this value in the draft for this field — the one predicate every
   *  option chip asks, of itself, to colour and mark itself. */
  const picked = (key: string, value: string): boolean =>
    askDraft(props.row.id, key).includes(value);

  const answers = (): AskAnswer[] =>
    ask()
      .fields.map((field) => ({
        key: field.key,
        values: [...askDraft(props.row.id, field.key)],
      }))
      .filter((answer) => answer.values.length > 0);

  const submit = (): void => {
    orch.answer(props.row.id, answers());
    forgetAskDraft(props.row.id);
  };

  const pick = (key: string, value: string, multiple: boolean): void => {
    const current = askDraft(props.row.id, key);
    if (!multiple) {
      setAskDraft(props.row.id, key, [value]);
      return;
    }
    setAskDraft(
      props.row.id,
      key,
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
  };

  return (
    <section
      data-testid="orchestrator-ask"
      data-ask-id={props.row.id}
      data-settled={settled() ? "" : undefined}
      class="rounded-xl border border-alert/55 bg-alert/[0.08] px-3 py-2.5 text-xs"
    >
      <header class="flex items-center gap-2 mb-1">
        <span class="text-alert text-base leading-none">✱</span>
        <b class="text-[0.78rem]">Orchestrator asks you</b>
      </header>
      <p class="text-fg whitespace-pre-wrap">{props.row.text}</p>
      <Show when={ask().link}>
        {(link) => (
          <a
            href={link().url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="orchestrator-ask-link"
            class="mt-1.5 block text-accent hover:underline break-all"
          >
            {link().url} <span class="text-fg-3">· {link().host}</span>
          </a>
        )}
      </Show>
      <Show
        when={!settled()}
        fallback={
          <p
            data-testid="orchestrator-ask-outcome"
            class="mt-2 font-mono text-[0.65rem] text-fg-3"
          >
            {ask().outcome?.how}
          </p>
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
                    data-testid="orchestrator-ask-input"
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
                            data-testid="orchestrator-ask-option"
                            data-field={field.key}
                            data-value={choice.value}
                            data-active={on() ? "" : undefined}
                            title={choice.hint ?? undefined}
                            class={OPTION_CLASS}
                            classList={{
                              "border-accent bg-accent/15": on(),
                              "border-edge-bright bg-surface-2": !on(),
                            }}
                            onClick={() =>
                              pick(
                                field.key,
                                choice.value,
                                field.kind === "choices",
                              )
                            }
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
                            data-testid="orchestrator-ask-option"
                            data-field={field.key}
                            data-value={value}
                            data-active={on() ? "" : undefined}
                            class={OPTION_CLASS}
                            classList={{
                              "border-accent bg-accent/15": on(),
                              "border-edge-bright bg-surface-2": !on(),
                            }}
                            onClick={() => pick(field.key, value, false)}
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
                    data-testid="orchestrator-ask-other"
                    data-field={other().key}
                    placeholder={other().label ?? "Other…"}
                    value={askDraft(props.row.id, other().key)[0] ?? ""}
                    class="mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent"
                    onInput={(event) =>
                      setAskDraft(
                        props.row.id,
                        other().key,
                        event.currentTarget.value === ""
                          ? []
                          : [event.currentTarget.value],
                      )
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
            data-testid="orchestrator-ask-submit"
            class="rounded-md bg-accent px-3 py-1 font-semibold text-surface-0 cursor-pointer"
            onClick={submit}
          >
            Answer
          </button>
          <button
            type="button"
            data-testid="orchestrator-ask-dismiss"
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

export default OrchestratorAsk;
