/** THE CONDUCTOR'S MARK on a terminal that belongs to a piece of work — ◆,
 *  the part it plays, and the work it plays it in.
 *
 *  It is drawn wherever a terminal is drawn OUTSIDE the conversation: the dock
 *  row's annotation line and the tile's title bar. Both read the SAME
 *  derivation (`membershipOf`, through `useMembership`), so a terminal cannot
 *  be a planner in the dock and nothing on its tile — there is one index and
 *  three readers of it.
 *
 *  Inline, in the flow of the words it belongs to, rather than an absolutely
 *  positioned badge: on a dock row the mark shares the annotation column with
 *  the terminal's own name, and sharing the column is what lets the two
 *  truncate together instead of one covering the other.
 *
 *  The ROLE is what it says and the TITLE is what it carries: a role is two
 *  words and fits, a work's title is a sentence and would push the name it
 *  sits beside off the row — so the title rides in the tooltip, where a reader
 *  who wants to know which waterfall this is can reach it. */

import { type Component, Show } from "solid-js";
import { useMembership } from "./useWorks";
import { ROLE_WORD } from "./workReadings";

const WorkMark: Component<{
  /** The fleet ref (`<encodedHostKey>/<terminalId>`) of the terminal this
   *  mark is about. Nothing is drawn for a terminal that is not an active
   *  member of a work in progress. */
  terminal: string;
}> = (props) => {
  const membership = useMembership();
  return (
    <Show when={membership().get(props.terminal)}>
      {(at) => (
        <span
          data-testid="work-mark"
          data-role={at().role}
          data-work={at().work}
          // WHO DRIVES IT, on the mark itself — a dock row is where a person
          // looks to see what is happening across the fleet, and a terminal
          // they took over reads as theirs there as well as on its tile.
          data-driver={at().driver ?? undefined}
          title={`${ROLE_WORD[at().role]} of “${at().title}”${
            at().driver === "you" ? " · taken over by you" : ""
          }`}
          class={`me-1 inline-flex min-w-0 shrink items-center gap-1 rounded-sm px-1 font-mono text-[0.58rem] font-semibold leading-[1.4] align-[0.05em] ${
            at().driver === "you"
              ? "bg-alert/15 text-alert"
              : "bg-conductor/15 text-conductor"
          }`}
        >
          <span aria-hidden="true">◆</span>
          <span class="uppercase tracking-[0.06em]">
            {ROLE_WORD[at().role]}
          </span>
          <span
            class={`min-w-0 truncate font-normal normal-case ${
              at().driver === "you" ? "text-alert/80" : "text-conductor/80"
            }`}
          >
            · {at().driver === "you" ? "taken over · " : ""}
            {at().title}
          </span>
        </span>
      )}
    </Show>
  );
};

export default WorkMark;
