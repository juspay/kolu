/** THE CONDUCTOR'S MARK on a terminal that belongs to a piece of work — ◆
 *  and the part it plays.
 *
 *  The DOCK ROW is where it is drawn, and the only place: the dock is the one
 *  list that shows terminals a person is not looking at, so a row has to say
 *  for itself that this terminal is in a waterfall. A tile says it by its own
 *  frame instead (`WorkLock`) — the header is overloaded, and the terminal's
 *  body is right there — so nothing is added to the title bar.
 *
 *  Beside the row's NAME, never in place of it: the name is what every other
 *  row shows on its first line, and the mark that replaced it left the row
 *  unrecognisable (#2376 review). The name truncates, the mark does not — a
 *  two-word mark costs the name a couple of characters it can spare, and it
 *  reads at any dock width.
 *
 *  The ROLE is what it says: a role is one word and fits, a work's title is a
 *  sentence and would push the name off the row — so the title rides in the
 *  tooltip, where a reader who wants to know which waterfall this is can
 *  reach it. */

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
          class={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-[0.55rem] font-semibold uppercase leading-[1.4] tracking-[0.06em] align-[0.05em] ${
            at().driver === "you"
              ? "bg-alert/15 text-alert"
              : "bg-conductor/15 text-conductor"
          }`}
        >
          <span aria-hidden="true">◆</span>
          {ROLE_WORD[at().role]}
        </span>
      )}
    </Show>
  );
};

export default WorkMark;
