/** Labeled section with title and bottom border — shared across right panel tabs.
 *
 *  Two shapes behind one header style:
 *  - default: static block, children always rendered (existing callers).
 *  - `collapsible`: the header becomes a native `<details>`/`<summary>` toggle
 *    with a rotating chevron, closed until the user opens it. Reserved for
 *    reference-tier sections (Attach) — a section whose content answers "what is
 *    happening" stays static. Deliberately NO `defaultOpen`: a section that
 *    wants to open itself from a FACT is `Disclosure`'s job (it re-asserts a
 *    reactive default through a `ref` + effect); a plain `open={…}` JSX binding
 *    here would look like a one-shot initializer while behaving reactively.
 *
 *  `status` renders right-aligned in the header either way — a rollup chip the
 *  header can carry while the body is folded.
 *
 *  The `<details>` chevron duplicates `Disclosure`'s markup and cannot share it:
 *  the rotate variant is `group-open/<name>`, whose name must differ between the
 *  two (a `Disclosure` nests INSIDE a collapsible `Section` — the CLI reference
 *  inside Attach — and one shared group name would rotate the inner chevron
 *  whenever the outer section is open), and Tailwind only extracts such variants
 *  from literal class strings, so it cannot be parameterized. */

import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";
import { ChevronRightIcon } from "./Icons";
import { SUMMARY_RESET } from "./disclosureChrome";

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
        class={`group/sec ${frame()}`}
        data-testid={props["data-testid"]}
      >
        <summary
          class={SUMMARY_RESET}
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
