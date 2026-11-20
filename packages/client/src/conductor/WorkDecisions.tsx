import { Option } from "effect";
import type { Work } from "kolu-work";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import {
  answerSource,
  answeredWhen,
  answerWords,
  clockOf,
  otherDecisions,
  setupLine,
} from "./workReadings";

const DECISIONS_SHOWN = 3;

const WorkDecisions: Component<{ work: Work }> = (props) => {
  const setup = createMemo(() => setupLine(props.work));
  const others = createMemo(() => otherDecisions(props.work));
  const [all, setAll] = createSignal(false);
  const shown = createMemo(() =>
    all() ? others() : others().slice(-DECISIONS_SHOWN),
  );
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set());
  const toggle = (id: string): void => {
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  return (
    <>
      <Show when={setup().length > 0}>
        <section class="mt-2.5">
          <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
            Setup
          </h4>
          <p
            data-testid="work-setup"
            title={setup()
              .map((part) => part.text)
              .join(" · ")}
            class="m-0 mt-1 truncate text-[0.7rem] text-fg"
          >
            <For each={setup()}>
              {(part, index) => (
                <>
                  <Show when={index() > 0}>
                    <span class="text-fg-3"> · </span>
                  </Show>
                  <span
                    data-testid="work-setup-part"
                    data-key={part.key}
                    data-from={Option.getOrUndefined(part.from)}
                    data-answer={part.answer}
                  >
                    {part.text}
                  </span>
                </>
              )}
            </For>
          </p>
        </section>
      </Show>

      <Show when={others().length > 0}>
        <section data-testid="work-decisions" class="mt-2.5">
          <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
            Decisions
          </h4>
          <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            <For each={shown()}>
              {(row) => (
                <li
                  data-testid="work-decision"
                  data-from={Option.getOrUndefined(row.from)}
                  data-answer={row.decisions
                    .map((one) => answerWords(one))
                    .join(" · ")}
                  class="min-w-0 text-[0.7rem]"
                >
                  <button
                    type="button"
                    data-testid="work-decision-row"
                    aria-expanded={opened().has(row.id)}
                    class="flex w-full min-w-0 cursor-pointer items-baseline gap-1 rounded-sm text-start hover:bg-surface-1"
                    onClick={() => toggle(row.id)}
                  >
                    <span class="shrink-0 text-fg-3">{row.label}</span>
                    <span class="min-w-0 flex-1 truncate text-fg">
                      — {row.answer}
                    </span>
                  </button>
                  <Show when={opened().has(row.id)}>
                    <div
                      data-testid="work-decision-detail"
                      class="mb-1 mt-0.5 border-s border-edge ps-1.5"
                    >
                      <For each={row.decisions}>
                        {(decision) => (
                          <p class="m-0 text-[0.65rem] text-fg-2">
                            {decision.question}
                            <span class="font-mono text-[0.6rem] text-fg-3">
                              {" · "}
                              {answeredWhen(decision, clockOf)}
                              <Show
                                when={Option.getOrUndefined(
                                  answerSource(decision),
                                )}
                              >
                                {(from) => <> · {from()}</>}
                              </Show>
                            </span>
                          </p>
                        )}
                      </For>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={others().length > DECISIONS_SHOWN}>
            <button
              type="button"
              data-testid="work-decisions-all"
              aria-expanded={all()}
              class="mt-1 cursor-pointer text-[0.66rem] text-accent hover:underline"
              onClick={() => setAll((was) => !was)}
            >
              {all() ? `latest ${DECISIONS_SHOWN}` : `all ${others().length}`}
            </button>
          </Show>
        </section>
      </Show>
    </>
  );
};

export default WorkDecisions;
