/** Dock recency cell — renders a terminal's "Xs ago" (`formatTimeAgo`).
 *
 *  The timestamp is the row's `rowRecencyAt` — `lastActivityAt` for a live
 *  tile, `sleptAt` for a sleeping one — the SAME value the activity window
 *  keys on, so the age a row shows is the age that decides whether the window
 *  hides it.
 *
 *  Active rows hide the label: an active terminal (the ONE shared predicate,
 *  `attentionActive` — do not re-derive the formula here) is "just now" by
 *  definition, so the text is noise. The fixed `w-[8ch]` still reserves the
 *  column so rows do not jump when the cell appears on quiet.
 *
 *  EXCEPT a blocked row (`asking`): an `awaiting_user` agent is pip-active
 *  (glow) yet its age is the OPPOSITE of noise — it is how long the agent has
 *  been waiting on you (`lastActivityAt` is the transition INTO the state), and
 *  a 20-hour wait must be legible at a glance (fucknotif). The cell renders the
 *  same timestamp as a violet WAIT chip instead of hiding it — the needs-you
 *  capsule vocabulary, carrying duration instead of a count.
 *
 *  The fixed `w-[8ch]` reserves the WIDEST `formatTimeAgo` string ("just now" =
 *  8ch, also covering "59m ago" / "23h ago" / "99d ago"), so a changing label
 *  never collapses the cell's track or overflows into the adjacent column;
 *  right-aligned so the timestamp lands in one column across rows. Shared by
 *  the desktop dock row (`DockRow`) and the touch drawer row (`DockListRow`)
 *  so that width contract — the load-bearing no-reflow invariant — lives in
 *  exactly one place; the two only differ in font size, passed as `textSize`. */

import { NEEDS_YOU_PILL_CLASS } from "@kolu/solid-statepip/pipVariant";
import type { Component } from "solid-js";
import { Show } from "solid-js";
import { formatTimeAgo, useDuration } from "../../terminal/staleness";

const RecencyCell: Component<{
  /** The row's recency timestamp (`rowRecencyAt`) — `lastActivityAt` for a
   *  live tile, `sleptAt` for a sleeping one. The age the window acts on.
   *  `null` — never-active — renders as the empty string
   *  (`formatTimeAgo`'s honest "nothing to report"). */
  recencyAt: number | null;
  /** Tailwind text-size token — the only thing the desktop and touch rows
   *  differ by (e.g. `text-[0.6rem]` vs `text-[0.65rem]`). */
  textSize: string;
  /** Hide the label while the terminal is active (`attentionActive`). Column
   *  width is still reserved. */
  hidden?: boolean;
  /** The row's agent is blocked on you — render the age as the violet wait
   *  chip (overrides `hidden`: a blocked row's age is the signal). */
  asking?: boolean;
}> = (props) => {
  // Compact live duration ("2m" → "20h") for the wait chip — the reactive 1s
  // clock, so a long-blocked agent's chip counts up without a repaint hook.
  // Compact (not "2m ago"): the capsule sits in the 8ch recency track and the
  // suffix would wrap it.
  const duration = useDuration();
  return (
    <span
      class={`inline-flex justify-end w-[8ch] font-mono tabular-nums text-fg-3 ${props.textSize}`}
    >
      <Show
        when={props.asking}
        fallback={props.hidden ? "" : formatTimeAgo(props.recencyAt)}
      >
        {/* The needs-you capsule vocabulary (same token as the count pills),
         *  carrying duration instead of a count. */}
        <span
          data-testid="dock-wait-chip"
          class={`${NEEDS_YOU_PILL_CLASS} px-1.5 h-4 whitespace-nowrap`}
          title="How long this agent has been waiting on your input"
        >
          {props.recencyAt === null ? "" : duration(props.recencyAt)}
        </span>
      </Show>
    </span>
  );
};

export default RecencyCell;
