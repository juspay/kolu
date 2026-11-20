import { compactPhrase, dualPhrase } from "@kolu/terminal-vocab/duration";
import {
  STAGES,
  type Stage,
  type StageName,
  type Stages,
  type StageState,
  type Waiter,
} from "kolu-work";
import { type Component, createMemo, Index, Show } from "solid-js";
import { STAGE_LABEL, WAITER_INK } from "./workReadings";

const cellInk = (state: StageState): string => {
  switch (state.kind) {
    case "now":
      return WAITER_INK[state.who].now;
    case "done":
      return `border-transparent ${WAITER_INK[state.who].tint}`;
    case "not-started":
      return "border-transparent bg-fg-3/10";
    case "skipped":
      return "border-dashed border-edge-bright";
    default:
      return state satisfies never;
  }
};

const STATE_WORD: Record<StageState["kind"], string> = {
  done: "done",
  now: "now",
  "not-started": "not started",
  skipped: "did not happen",
};

const WHOSE: Record<Waiter, string> = {
  agent: "the agents' time",
  you: "your time",
  ci: "CI's time",
};

const timeOf = (state: StageState): string => {
  switch (state.kind) {
    case "done":
    case "now":
      return compactPhrase(state.ms);
    case "skipped":
      return "–";
    case "not-started":
      return "";
    default:
      return state satisfies never;
  }
};

const exactOf = (state: StageState): string | undefined =>
  state.kind === "done" || state.kind === "now"
    ? dualPhrase(state.ms)
    : undefined;

const QUIET: ReadonlyArray<Stage> = STAGES.map((name) => ({
  name,
  state: { kind: "not-started" },
}));

const StageStrip: Component<{
  stages: Stages;
  size: "full" | "mini";
  testId: "stage-strip" | "chip-stage-strip";
  index?: {
    readonly shown: () => StageName | undefined;
    readonly show: (stage: StageName) => void;
  };
}> = (props) => {
  const cells = createMemo((): ReadonlyArray<Stage> | undefined => {
    const one = props.stages;
    switch (one.kind) {
      case "none":
        return undefined;
      case "unset":
        return QUIET;
      case "staged":
        return one.stages;
      default:
        return one satisfies never;
    }
  });
  const full = () => props.size === "full";
  return (
    <Show when={cells()}>
      {(all) => (
        <ol
          data-testid={props.testId}
          data-size={props.size}
          data-run={props.stages.kind}
          aria-label="Stages"
          class={`m-0 grid list-none grid-cols-6 gap-[3px] p-0 ${full() ? "mt-2" : "mt-1.5"}`}
        >
          <Index each={all()}>
            {(stage) => {
              const state = () => stage().state;
              const who = (): Waiter | undefined => {
                const now = state();
                return now.kind === "done" || now.kind === "now"
                  ? now.who
                  : undefined;
              };
              const cellClass = () =>
                `block w-full min-w-0 rounded-md border text-center ${cellInk(
                  state(),
                )} ${full() ? "py-0.5" : "py-px"}`;
              const face = () => (
                <>
                  <small
                    class={`block truncate leading-tight ${
                      full() ? "text-[0.6rem]" : "text-[0.55rem]"
                    } ${state().kind === "now" ? "font-semibold text-fg" : "text-fg-3"}`}
                  >
                    {STAGE_LABEL[stage().name]}
                  </small>
                  <b
                    aria-hidden="true"
                    class={`block min-h-[1.3em] font-mono font-semibold leading-snug tabular-nums ${
                      full() ? "text-[0.66rem]" : "text-[0.6rem]"
                    } ${who() === undefined ? "text-fg-3" : "text-fg"}`}
                  >
                    {timeOf(state())}
                  </b>
                  <span class="sr-only">
                    {exactOf(state()) ?? ""}
                    {(() => {
                      const whose = who();
                      return whose === undefined ? ", " : `, ${WHOSE[whose]}, `;
                    })()}
                    {STATE_WORD[state().kind]}
                  </span>
                </>
              );
              return (
                <li
                  data-testid="stage"
                  data-stage={stage().name}
                  data-state={state().kind}
                  data-who={who()}
                  title={(() => {
                    const exact = exactOf(state());
                    return exact === undefined
                      ? undefined
                      : `${STAGE_LABEL[stage().name]} ${exact}`;
                  })()}
                  data-shown={
                    props.index?.shown() === stage().name ? "" : undefined
                  }
                  class="min-w-0"
                >
                  <Show
                    when={who() === undefined ? undefined : props.index}
                    fallback={<span class={cellClass()}>{face()}</span>}
                  >
                    {(index) => (
                      <button
                        type="button"
                        data-testid="stage-cell"
                        aria-pressed={index().shown() === stage().name}
                        class={`${cellClass()} cursor-pointer hover:brightness-110 ${
                          index().shown() === stage().name
                            ? "shadow-[0_2px_0_0_currentColor]"
                            : ""
                        }`}
                        onClick={() => index().show(stage().name)}
                      >
                        {face()}
                      </button>
                    )}
                  </Show>
                </li>
              );
            }}
          </Index>
        </ol>
      )}
    </Show>
  );
};

export default StageStrip;
