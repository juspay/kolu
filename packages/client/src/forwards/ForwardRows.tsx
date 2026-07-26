/**
 * The host dropdown's list of doors.
 *
 * The Inspector no longer renders a "Forwarded Ports" GROUP — its ports section
 * merged the two, so a forwarded port is one row carrying its own door inline.
 * This is a host's doors, listed as such: the remote port, what serves it, and
 * the door itself.
 *
 * What a door LOOKS like and what you can do with it are `ForwardPill.tsx`'s —
 * both surfaces compose the same two pieces rather than each assembling its own
 * from the parts.
 */

import type { KoluForward } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { ForwardControls, ForwardPill } from "./ForwardPill";
import { ServingTerminalLink } from "./ServingTerminalLink";

/** One row. `serving`, when supplied, NAMES the terminal serving this port and
 *  makes that name the way back to it — the answer to "what IS this?", which a
 *  row of numbers otherwise leaves hanging. Absent when nothing serves it (a ⌘K
 *  forward, or a server that has died): the row says nothing rather than
 *  inventing a name, because a door you cannot cancel is worse than one with no
 *  link. */
export const ForwardRow: Component<{
  forward: KoluForward;
  serving?: { name: string; jump: () => void };
}> = (props) => (
  <div
    class="group/fwd flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 text-[11px] leading-snug transition-colors hover:bg-surface-2/60 motion-reduce:transition-none"
    data-testid="forward-row"
    data-port={props.forward.remotePort}
    data-origin={props.forward.origin}
  >
    {/* The REMOTE port, plainly. The hostname is the dropdown's own title, so
     *  repeating it on every row was the loudest thing in a panel about one
     *  host. The number does NOT carry the jump: it did in the previous cut and
     *  the underline marking it was reported as invisible. */}
    <span class="shrink-0 font-mono tabular-nums text-fg">
      {props.forward.remotePort}
    </span>
    {/* …and WHAT is behind it, which is both the answer and the link. */}
    <Show when={props.serving}>
      {(s) => <ServingTerminalLink name={s().name} onJump={s().jump} />}
    </Show>
    <ForwardPill forward={props.forward} link testid="forward-open" />
    <span class="ml-auto flex shrink-0 items-center">
      <ForwardControls forward={props.forward} />
    </span>
  </div>
);

/** The rows for a list, or nothing at all when there are none. Rendering an
 *  empty "Forwarded Ports" heading would be a claim about a feature the user may
 *  never have used; absence is the honest empty state. */
export const ForwardRows: Component<{
  forwards: readonly KoluForward[];
  /** Which terminal serves a given forward, and how to reach it. The lookup
   *  lives with the caller because only it holds that host's terminals. */
  servingFor?: (
    forward: KoluForward,
  ) => { name: string; jump: () => void } | undefined;
}> = (props) => (
  <Show when={props.forwards.length > 0}>
    <div class="flex flex-col gap-1" data-testid="forward-rows">
      <For each={props.forwards}>
        {(forward) => (
          <ForwardRow forward={forward} serving={props.servingFor?.(forward)} />
        )}
      </For>
    </div>
  </Show>
);
