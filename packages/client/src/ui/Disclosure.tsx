/** Inline disclosure — a native `<details>` with a rotating chevron summary.
 *
 *  Used for the Inspector's tier-3 "reference" content (a green check list,
 *  repo paths, the kaval CLI cheatsheet): folded until asked for, or until it
 *  becomes exceptional. The `open` prop is a *reactive default*, not a
 *  controlled value: an effect re-asserts it whenever it CHANGES (so a check
 *  run flipping to `fail` auto-expands the list even mid-session), while a
 *  manual toggle in between is left alone — the user's click wins until the
 *  fact changes again. Native `<details>` carries the keyboard/ARIA behavior,
 *  so there is no toggle state to hand-roll. */

import { type Component, createEffect, type JSX } from "solid-js";
import { ChevronRightIcon } from "./Icons";

const Disclosure: Component<{
  summary: JSX.Element;
  /** Reactive default-open. Re-asserted on every change of the value. */
  open?: boolean;
  "data-testid"?: string;
  children: JSX.Element;
}> = (props) => {
  let el!: HTMLDetailsElement;
  createEffect(() => {
    el.open = props.open ?? false;
  });
  return (
    <details ref={el} class="group/disc" data-testid={props["data-testid"]}>
      <summary class="flex cursor-pointer select-none list-none items-center gap-1.5 py-0.5 text-[10.5px] font-mono text-fg-3 transition-colors hover:text-fg [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon class="h-3 w-3 shrink-0 transition-transform group-open/disc:rotate-90 motion-reduce:transition-none" />
        {props.summary}
      </summary>
      <div class="pl-4 pt-1">{props.children}</div>
    </details>
  );
};

export default Disclosure;
