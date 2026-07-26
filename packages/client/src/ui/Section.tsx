/** Labeled section with title and bottom border — shared across right panel tabs.
 *
 *  Two shapes behind one header style:
 *  - default: static block, children always rendered (existing callers).
 *  - `collapsible`: the header becomes a native `<details>`/`<summary>` toggle
 *    with a rotating chevron; `defaultOpen` picks the initial state. Reserved
 *    for reference-tier sections (Attach) — a section whose content answers
 *    "what is happening" stays static.
 *
 *  `status` renders right-aligned in the header either way — a rollup chip the
 *  header can carry while the body is folded. */

import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";
import { ChevronRightIcon } from "./Icons";

const HEADER_CLASS =
  "text-[10px] font-bold uppercase tracking-[0.1em] text-fg-3/60";

const Section: Component<{
  title: string;
  /** Accent color class for the left border (e.g. "border-accent"). */
  accent?: string;
  /** Right-aligned header slot — e.g. a rollup chip. */
  status?: JSX.Element;
  collapsible?: boolean;
  /** Initial state for a collapsible section (uncontrolled after mount). */
  defaultOpen?: boolean;
  "data-testid"?: string;
  children: JSX.Element;
}> = (props) => {
  const frame = () =>
    `py-3 px-3 border-b border-edge ${props.accent ? `border-l-2 ${props.accent}` : ""}`;
  return (
    <Show
      when={props.collapsible}
      fallback={
        <div class={frame()} data-testid={props["data-testid"]}>
          <div class="mb-2 flex items-center justify-between gap-2">
            <div class={HEADER_CLASS}>{props.title}</div>
            {props.status}
          </div>
          {props.children}
        </div>
      }
    >
      <details
        class={`group/sec ${frame()}`}
        open={props.defaultOpen}
        data-testid={props["data-testid"]}
      >
        <summary
          class="flex cursor-pointer select-none list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden"
          data-testid={
            props["data-testid"] ? `${props["data-testid"]}-toggle` : undefined
          }
        >
          <ChevronRightIcon class="h-3 w-3 shrink-0 text-fg-3/60 transition-transform group-open/sec:rotate-90 motion-reduce:transition-none" />
          <div class={HEADER_CLASS}>{props.title}</div>
          <span class="ml-auto">{props.status}</span>
        </summary>
        <div class="mt-2">{props.children}</div>
      </details>
    </Show>
  );
};

export default Section;
