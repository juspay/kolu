import { DASH } from "kolu-common/surface";
import { Option } from "effect";
import type { Work } from "kolu-work";
import { type Component, Show } from "solid-js";
import { elapsedSince } from "../time/duration";
import PrText from "./PrText";
import { type StandingLine, WAITER_INK } from "./workReadings";

const WorkStanding: Component<{
  work: Work;
  line: StandingLine;
  now: number;
  testId: "work-standing" | "work-chip-standing";
}> = (props) => {
  const clock = (): string => {
    const elapsed = elapsedSince(props.line.since, props.now);
    switch (props.line.clock) {
      case "asked":
        return elapsed === DASH ? "asked just now" : `asked ${elapsed} ago`;
      case "green":
        return `green for ${elapsed}`;
      case "ended":
        return elapsed === DASH ? "just now" : `${elapsed} ago`;
      case "for":
        return elapsed;
      default:
        return props.line.clock satisfies never;
    }
  };
  const ink = (): string => {
    const who = props.line.who;
    return who === "done" ? "text-fg-2" : WAITER_INK[who].text;
  };
  return (
    <span
      data-testid={props.testId}
      data-who={props.line.who}
      class="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[0.7rem]"
    >
      <b class={ink()}>{props.line.lead}</b>
      <Show when={Option.getOrUndefined(props.line.what)}>
        {(what) => (
          <span
            data-testid="work-standing-what"
            class={`min-w-0 truncate ${
              props.line.who === "you"
                ? `font-semibold ${WAITER_INK.you.text}`
                : "text-fg-2"
            }`}
          >
            · <PrText work={props.work} text={what()} />
          </span>
        )}
      </Show>
      <span class="font-mono text-[0.62rem] tabular-nums text-fg-3">
        · {clock()}
      </span>
    </span>
  );
};

export default WorkStanding;
