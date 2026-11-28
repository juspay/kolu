/**
 * WHY A WORK IS STILL UNDER ITS OLD KEY — one line on the card, read by
 * {@link heldWords} against every work kolu holds. A work whose key is not
 * held draws nothing.
 */

import { Option } from "effect";
import type { Work } from "kolu-work";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { heldWords } from "./workReadings";
import { useWorkAt } from "./useWorks";

const WorkHeld: Component<{ readonly work: Work }> = (props) => {
  // The work holding the branch is read BY ITS ID ({@link useWorkAt}), so a
  // card on a board of hundreds depends on the one work its line names and
  // not on every work kolu holds.
  const line = () => Option.getOrUndefined(heldWords(props.work, useWorkAt));
  return (
    <Show when={line()}>
      {(text) => (
        <p
          data-testid="work-held"
          class="m-0 mt-0.5 min-w-0 truncate font-mono text-[0.62rem] text-fg-3"
        >
          {text()}
        </p>
      )}
    </Show>
  );
};

export default WorkHeld;
