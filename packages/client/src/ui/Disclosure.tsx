/** Inline disclosure — a native `<details>` with a rotating chevron summary.
 *  `open` is a reactive DEFAULT, not a controlled value: it is re-asserted
 *  whenever the value changes, and a manual toggle in between is left alone. */

import { type Component, createEffect, createMemo, type JSX } from "solid-js";
import { DISCLOSURE_GROUPS, SUMMARY_RESET } from "./disclosureChrome";
import { ChevronRightIcon } from "./Icons";

const Disclosure: Component<{
  summary: JSX.Element;
  /** Reactive default-open. Re-asserted on every change of the value. */
  open?: boolean;
  "data-testid"?: string;
  children: JSX.Element;
}> = (props) => {
  let el!: HTMLDetailsElement;
  const open = createMemo(() => props.open ?? false);
  createEffect(() => {
    el.open = open();
  });
  return (
    <details
      ref={el}
      class={DISCLOSURE_GROUPS.disc.root}
      data-testid={props["data-testid"]}
    >
      <summary
        class={`${SUMMARY_RESET} py-0.5 font-mono text-[10.5px] text-fg-3 transition-colors hover:text-fg`}
      >
        <ChevronRightIcon class={DISCLOSURE_GROUPS.disc.chevron} />
        {props.summary}
      </summary>
      <div class="pl-4 pt-1">{props.children}</div>
    </details>
  );
};

export default Disclosure;
