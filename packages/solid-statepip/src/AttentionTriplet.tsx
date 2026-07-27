/** The attention TRIPLET — active · needs-you · unread — the ONE summary
 *  component every altitude renders: the host tab, the host switcher row, the
 *  mobile host chip, and the dock's per-repo section header. One component so
 *  the same fact cannot render four different ways again (the fucknotif
 *  defect: `HostAwaitingPill` + `HostUnseenPill` + a decoy row-count capsule
 *  + a half-alpha pip all spoke different dialects).
 *
 *  Vocabulary (colour law from `@kolu/theme`, shapes from this package):
 *    · active — bare rust count + small spinner: how many terminals have
 *      something happening in them. Informational: no capsule, never
 *      clickable.
 *    · needs-you — VIOLET CAPSULE. Actionable: when `onAsking` is supplied it
 *      renders as a real `<button>` that navigates to the next blocked
 *      terminal. Clicking never dismisses — only the agent leaving
 *      `awaiting_user` clears it.
 *    · unread — AMBER CAPSULE. Actionable via `onUnseen` where a surface has
 *      somewhere to send you — the dock section header does. A host tab does
 *      NOT pass one, because arriving at a host is itself what clears the
 *      count: there is no "next unread" left to jump to once you are there.
 *      Cleared by opening the terminal, never by clicking.
 *
 *  The capsule rule: a number in a capsule is always an actionable attention
 *  count; a bare number is never a notification. Callers that sit INSIDE an
 *  interactive element (the mobile host chip is one big `<button>`) omit the
 *  handlers, so the segments render as plain spans and the HTML stays valid —
 *  interactivity is per-surface, the visual vocabulary is not.
 *
 *  `sizeClass` is the ONLY per-surface pixel (min-width / height / padding),
 *  the same discipline the retired pills followed. Segments hide at zero; the
 *  whole triplet renders nothing when all three are zero. */

import { type Component, Show } from "solid-js";
import {
  NEEDS_YOU_PILL_CLASS,
  UNSEEN_COUNT_CLASS,
  WORKING_COUNT_CLASS,
} from "./pipVariant.ts";

/** The working spinner — a bare arc that rides the shared statepip spin
 *  cadence (`--motion-spin-duration`), so "in flight" moves at the same tempo
 *  everywhere a pip does. */
const WorkingArc: Component = () => (
  <svg
    class="statepip-anim-spin motion-reduce:animate-none w-[10px] h-[10px]"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2.4"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M14 8a6 6 0 1 1-4.2-5.72" />
  </svg>
);

/** One actionable capsule — a `<button>` when a handler is supplied (host tab,
 *  section header), a plain `<span>` when the caller is itself interactive
 *  (mobile chip). */
const CountCapsule: Component<{
  count: number;
  class: string;
  title: string;
  ariaLabel: string;
  testid: string;
  onJump?: () => void;
}> = (props) => (
  <Show when={props.count > 0}>
    <Show
      when={props.onJump}
      fallback={
        <span
          role="img"
          class={props.class}
          title={props.title}
          aria-label={props.ariaLabel}
          data-testid={props.testid}
        >
          {props.count}
        </span>
      }
    >
      {(jump) => (
        <button
          type="button"
          class={`${props.class} cursor-pointer`}
          title={props.title}
          aria-label={props.ariaLabel}
          data-testid={props.testid}
          onClick={(e) => {
            // The capsule navigates; the surface underneath it (a tab, a
            // header) has its own click meaning that must not also fire.
            e.stopPropagation();
            jump()();
          }}
        >
          {props.count}
        </button>
      )}
    </Show>
  </Show>
);

export const AttentionTriplet: Component<{
  /** Terminals with something happening in them — agents in flight, agents
   *  still settling after a turn, and plain shells that are printing. The one
   *  activity predicate (`attentionActive`), so this number always equals the
   *  number of moving marks in the scope it summarises. */
  active: number;
  /** Agents blocked on your input (`awaiting_user`). */
  asking: number;
  /** Finished terminals you have not opened. */
  unseen: number;
  /** The pill geometry — the only per-surface pixel (e.g. `min-w-4 px-1 h-4`). */
  sizeClass: string;
  /** Navigate to the next blocked terminal. Omit inside interactive parents. */
  onAsking?: () => void;
  /** Navigate to the next unread terminal. Omit inside interactive parents. */
  onUnseen?: () => void;
  /** a11y scope for the counts' sentences — a host label or repo name. */
  scopeLabel?: string;
  /** Extra classes on the root — applied only when the triplet renders at all,
   *  so an empty triplet contributes zero width (no phantom padding). */
  class?: string;
}> = (props) => {
  const scope = () => (props.scopeLabel ? ` on ${props.scopeLabel}` : "");
  return (
    <Show when={props.active > 0 || props.asking > 0 || props.unseen > 0}>
      <span
        class={`inline-flex shrink-0 items-center gap-1${props.class ? ` ${props.class}` : ""}`}
        data-testid="attention-triplet"
      >
        <Show when={props.active > 0}>
          <span
            role="img"
            class={WORKING_COUNT_CLASS}
            title={`${props.active} active${scope()}`}
            aria-label={`${props.active} terminals active${scope()}`}
            data-testid="attention-working"
          >
            <WorkingArc />
            {props.active}
          </span>
        </Show>
        <CountCapsule
          count={props.asking}
          class={`${NEEDS_YOU_PILL_CLASS} shrink-0 ${props.sizeClass}`}
          title={`${props.asking} awaiting your input${scope()}${props.onAsking ? " — click to jump" : ""}`}
          ariaLabel={`${props.asking} agents awaiting your input${scope()}`}
          testid="attention-asking"
          onJump={props.onAsking}
        />
        <CountCapsule
          count={props.unseen}
          class={`${UNSEEN_COUNT_CLASS} shrink-0 ${props.sizeClass}`}
          title={`${props.unseen} finished, unseen${scope()}${props.onUnseen ? " — click to jump" : ""}`}
          ariaLabel={`${props.unseen} finished terminals you haven't seen${scope()}`}
          testid="attention-unseen"
          onJump={props.onUnseen}
        />
      </span>
    </Show>
  );
};
