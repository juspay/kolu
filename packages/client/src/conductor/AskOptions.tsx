/** THE OPTIONS OF ONE QUESTION, pressable — and, past a handful of them, a
 *  box that narrows the list.
 *
 *  Two questions in a work's setup are drawn from a list kolu reads live: the
 *  harnesses this kolu carries, and the models a harness offers on the work's
 *  host. The second of those is routinely dozens of ids, and a row of forty
 *  chips is not a list a person reads — so the same component that draws four
 *  options draws forty with a box above them, and nothing else about a
 *  question changes with its length.
 *
 *  Narrowing is a plain case-insensitive contains over the value and the note
 *  beside it, the reading {@link AgentsProfileList}'s add-field already uses
 *  for its suggestions. It is NOT the palette's ranking: these options are a
 *  closed list a person is looking AT, not a catalogue they are searching,
 *  and a ranked reorder would move the thing they were reaching for.
 */

import { type Component, createMemo, createSignal, For, Show } from "solid-js";

/** One option as the list draws it. */
export interface AskOption {
  /** What answering with it sends, verbatim. */
  readonly value: string;
  /** How it is otherwise known — a harness's title (`Claude Code` beside
   *  `claude`); `""` for an option that is its own name. */
  readonly note: string;
}

/** An option that is its own name — every option a work's asker offered, and
 *  every model id. */
export const askOption = (value: string): AskOption => ({ value, note: "" });

/** THE DEFAULT IS DRAWN FIRST. What this person chose last time leads the
 *  list wherever it is drawn, so the thing already selected is also the thing
 *  under their eyes; the rest keep the order they came in. A `value` that is
 *  not among them (nothing remembered, or a model this host no longer lists)
 *  leaves the list exactly as it was. */
export function defaultFirst(
  options: ReadonlyArray<AskOption>,
  value: string | null,
): ReadonlyArray<AskOption> {
  if (value === null) return options;
  const first = options.find((one) => one.value === value);
  if (first === undefined) return options;
  return [first, ...options.filter((one) => one !== first)];
}

/** More options than this and the list gets a box to narrow it — about where
 *  a row of chips stops being something read at a glance. */
export const OPTION_SEARCH_FROM = 8;

/** The options whose value or note contains `text`, any case. */
function matching(
  options: ReadonlyArray<AskOption>,
  text: string,
): ReadonlyArray<AskOption> {
  const needle = text.trim().toLowerCase();
  if (needle === "") return options;
  return options.filter(
    (one) =>
      one.value.toLowerCase().includes(needle) ||
      one.note.toLowerCase().includes(needle),
  );
}

/** One option chip. The SELECTED state is layered on through `classList`, so
 *  the shape of a chip is written once and only the two colours branch. */
const OPTION_CLASS = "rounded-md border px-2.5 py-1 text-fg cursor-pointer";

const BOX_CLASS =
  "mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent";

const AskOptions: Component<{
  /** The decision these answer — every test id below carries it, so two
   *  questions open at once are told apart by the field and not by order. */
  field: string;
  options: ReadonlyArray<AskOption>;
  picked: (value: string) => boolean;
  onPick: (value: string) => void;
  /** What the box says it narrows ("models", "harnesses"). */
  searchLabel: string;
}> = (props) => {
  const [text, setText] = createSignal("");
  /** Read by the list and by the line that says nothing matched. */
  const shown = createMemo(() => matching(props.options, text()));
  return (
    <>
      <Show when={props.options.length > OPTION_SEARCH_FROM}>
        <input
          type="text"
          data-testid="conductor-ask-search"
          data-field={props.field}
          placeholder={`Search ${props.searchLabel}`}
          value={text()}
          class={BOX_CLASS}
          onInput={(event) => setText(event.currentTarget.value)}
        />
      </Show>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <For each={shown()}>
          {(option) => {
            const on = () => props.picked(option.value);
            return (
              <button
                type="button"
                data-testid="conductor-ask-option"
                data-field={props.field}
                data-value={option.value}
                data-active={on() ? "" : undefined}
                class={OPTION_CLASS}
                classList={{
                  "border-accent bg-accent/15": on(),
                  "border-edge-bright bg-surface-2": !on(),
                }}
                onClick={() => props.onPick(option.value)}
              >
                {option.value}
                <Show when={option.note !== ""}>
                  <span class="ml-1.5 text-fg-3">{option.note}</span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={shown().length === 0}>
        <p
          data-testid="conductor-ask-nomatch"
          class="mt-1.5 m-0 font-mono text-[0.62rem] text-fg-3"
        >
          Nothing here matches “{text()}”.
        </p>
      </Show>
    </>
  );
};

export default AskOptions;
export { AskOptions };
