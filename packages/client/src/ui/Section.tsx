/** Labeled section with title and bottom border — shared across right panel
 *  tabs. `collapsible` turns the header into a native `<details>`/`<summary>`
 *  toggle, closed until the user opens it; `status` renders right-aligned in
 *  the header either way. */

import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";
import { DISCLOSURE_GROUPS, SUMMARY_RESET } from "./disclosureChrome";
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
        class={`${DISCLOSURE_GROUPS.sec.root} ${frame()}`}
        data-testid={props["data-testid"]}
      >
        <summary
          class={SUMMARY_RESET}
          data-testid={
            props["data-testid"] ? `${props["data-testid"]}-toggle` : undefined
          }
        >
          <ChevronRightIcon class={DISCLOSURE_GROUPS.sec.chevron} />
          <div class={HEADER_CLASS}>{props.title}</div>
          <span class="ml-auto">{props.status}</span>
        </summary>
        <div class="mt-2">{props.children}</div>
      </details>
    </Show>
  );
};

export default Section;
