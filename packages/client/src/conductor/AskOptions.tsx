import { Option } from "effect";
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

export function defaultFirst(
  options: ReadonlyArray<AskOption>,
  value: Option.Option<string>,
): ReadonlyArray<AskOption> {
  const want = Option.getOrUndefined(value);
  if (want === undefined) return options;
  const first = options.find((one) => one.value === want);
  if (first === undefined) return options;
  return [first, ...options.filter((one) => one !== first)];
}

export const OPTION_SEARCH_FROM = 8;

/** The options whose value or note contains `text`, any case. */
function matching(
  options: ReadonlyArray<AskOption>,
  text: string,
): ReadonlyArray<AskOption> {
  const needle = text.trim().toLowerCase();
  return options.filter(
    (one) =>
      one.value.toLowerCase().includes(needle) ||
      one.note.toLowerCase().includes(needle),
  );
}

export function optionsShown(list: {
  readonly options: ReadonlyArray<AskOption>;
  readonly usedBefore: ReadonlyArray<string>;
  readonly picked: (value: string) => boolean;
  readonly search: string;
  readonly unfolded: boolean;
}): { readonly shown: ReadonlyArray<AskOption>; readonly hidden: number } {
  if (list.options.length <= OPTION_SEARCH_FROM)
    return { shown: list.options, hidden: 0 };
  if (list.search.trim() !== "")
    return { shown: matching(list.options, list.search), hidden: 0 };
  if (list.unfolded) return { shown: list.options, hidden: 0 };
  const used = new Set(list.usedBefore);
  const shown = list.options.filter(
    (one) => used.has(one.value) || list.picked(one.value),
  );
  return { shown, hidden: list.options.length - shown.length };
}

const OPTION_CLASS = "rounded-md border px-2.5 py-1 text-fg cursor-pointer";

const BOX_CLASS =
  "mt-1.5 w-full rounded-md border border-edge-bright bg-surface-0 px-2 py-1 text-fg outline-none focus:border-accent";

const LINK_CLASS =
  "cursor-pointer text-accent underline-offset-2 hover:underline";

const AskOptions: Component<{
  /** The decision these answer — every test id below carries it, so two
   *  questions open at once are told apart by the field and not by order. */
  field: string;
  options: ReadonlyArray<AskOption>;
  /** What this person answered this question with before, most recent
   *  first — what a long list rests on ({@link optionsShown}). */
  usedBefore: ReadonlyArray<string>;
  picked: (value: string) => boolean;
  onPick: (value: string) => void;
  /** What the box searches ("models", "harnesses"). */
  searchLabel: string;
}> = (props) => {
  const [text, setText] = createSignal("");
  const [unfolded, setUnfolded] = createSignal(false);
  const view = createMemo(() =>
    optionsShown({
      options: props.options,
      usedBefore: props.usedBefore,
      picked: props.picked,
      search: text(),
      unfolded: unfolded(),
    }),
  );
  const long = () => props.options.length > OPTION_SEARCH_FROM;
  return (
    <>
      <Show when={long()}>
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
      <Show when={view().shown.length > 0}>
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <For each={view().shown}>
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
      </Show>
      <Show
        when={
          long() && text().trim() === "" && (unfolded() || view().hidden > 0)
        }
      >
        <p
          data-testid="conductor-ask-more"
          data-field={props.field}
          data-hidden={view().hidden}
          class="mt-1.5 m-0 font-mono text-[0.62rem] text-fg-3"
        >
          <Show
            when={unfolded()}
            fallback={
              <>
                {view().hidden} more · search, or{" "}
                <button
                  type="button"
                  data-testid="conductor-ask-all"
                  data-field={props.field}
                  aria-expanded="false"
                  class={LINK_CLASS}
                  onClick={() => setUnfolded(true)}
                >
                  show all
                </button>
              </>
            }
          >
            <button
              type="button"
              data-testid="conductor-ask-all"
              data-field={props.field}
              aria-expanded="true"
              class={LINK_CLASS}
              onClick={() => setUnfolded(false)}
            >
              show fewer
            </button>
          </Show>
        </p>
      </Show>
      <Show when={text().trim() !== "" && view().shown.length === 0}>
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
