/** Dock recency cell — renders a terminal's "Xs ago" (`formatTimeAgo`).
 *
 *  The timestamp is the row's `rowRecencyAt` — `lastActivityAt` for a live
 *  tile, `sleptAt` for a sleeping one — the SAME value the activity window
 *  keys on, so the age a row shows is the age that decides whether the window
 *  hides it.
 *
 *  Three renderings, ONE prop naming which. Active rows hide the label: an
 *  active terminal (the shared `attentionActive` predicate — do not re-derive
 *  the formula here) is "just now" by definition, so the text is noise. EXCEPT
 *  a blocked row: an `awaiting_user` agent is pip-active (glow) yet its age is
 *  the OPPOSITE of noise — it is how long the agent has been waiting on you
 *  (`lastActivityAt` is the transition INTO the state), and a 20-hour wait must
 *  be legible at a glance (fucknotif). That row flips to the violet WAIT chip,
 *  the needs-you capsule vocabulary carrying a duration instead of a count.
 *
 *  The three used to arrive as two independent booleans (`hidden` + `asking`)
 *  assembled per call site from two different folds, with "asking overrides
 *  hidden" living only in the JSX nesting — a state machine spelled as flags,
 *  one of whose four combinations was unreachable and another duplicate. One
 *  `mode`, computed once beside the pip it comes from, and the illegal
 *  combination stops being spellable.
 *
 *  The fixed `w-[8ch]` reserves the WIDEST `formatTimeAgo` string ("just now" =
 *  8ch, also covering "59m ago" / "23h ago" / "99d ago"), so a changing label
 *  never collapses the cell's track or overflows into the adjacent column;
 *  right-aligned so the timestamp lands in one column across rows. Shared by
 *  the desktop dock row (`DockRow`) and the touch drawer row (`DockListRow`)
 *  so that width contract — the load-bearing no-reflow invariant — lives in
 *  exactly one place; the two only differ in font size, passed as `textSize`. */

import { NeedsYouCapsule } from "@kolu/solid-statepip";
import { DASH } from "kolu-common/surface";
import type { Component } from "solid-js";
import { Match, Switch } from "solid-js";
import { formatTimeAgo, useDuration } from "../../terminal/staleness";

/** Which of the cell's three renderings this row gets. `wait-chip` wins over
 *  `hidden` by being a distinct value rather than by an override rule. */
export type RecencyMode = "wait-chip" | "hidden" | "ago";

/** The row's mode, from the ONE bound attention value the pip is painted from —
 *  so the wash, the chip and the header count can't be reading different folds
 *  of the same terminal. */
export function recencyMode(pip: {
  asking: boolean;
  active: boolean;
}): RecencyMode {
  if (pip.asking) return "wait-chip";
  return pip.active ? "hidden" : "ago";
}

const RecencyCell: Component<{
  /** The row's recency timestamp (`rowRecencyAt`) — `lastActivityAt` for a
   *  live tile, `sleptAt` for a sleeping one. The age the window acts on.
   *  `null` — never-active — renders as the empty string in `ago` mode
   *  (`formatTimeAgo`'s honest "nothing to report") and as the dash in the
   *  wait chip, which cannot render an empty capsule: a violet pill with no
   *  glyph reads as a rendering bug, not as "unknown". */
  recencyAt: number | null;
  /** Tailwind text-size token — the only thing the desktop and touch rows
   *  differ by (e.g. `text-[0.6rem]` vs `text-[0.65rem]`). */
  textSize: string;
  mode: RecencyMode;
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
      <Switch>
        <Match when={props.mode === "wait-chip"}>
          <NeedsYouCapsule
            testid="dock-wait-chip"
            title="How long this agent has been waiting on your input"
          >
            {props.recencyAt === null ? DASH : duration(props.recencyAt)}
          </NeedsYouCapsule>
        </Match>
        <Match when={props.mode === "ago"}>
          {formatTimeAgo(props.recencyAt)}
        </Match>
      </Switch>
    </span>
  );
};

export default RecencyCell;
