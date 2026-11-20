import { type Component, type JSX, Show } from "solid-js";
import {
  ACTIVE_COUNT_CLASS,
  NEEDS_YOU_PILL_CLASS,
  UNSEEN_COUNT_CLASS,
} from "./pipVariant.ts";

/** The needs-you capsule as an ELEMENT — the violet silhouette with something
 *  in it. Exported so a surface that wants the shape (the dock's wait chip,
 *  which carries a duration instead of a count) reaches for the component
 *  rather than hand-composing this package's raw token beside its own
 *  padding. */
export const NeedsYouCapsule: Component<{
  title?: string;
  testid?: string;
  children: JSX.Element;
}> = (props) => (
  <span
    class={`${NEEDS_YOU_PILL_CLASS} px-1.5 h-4 whitespace-nowrap`}
    title={props.title}
    data-testid={props.testid}
  >
    {props.children}
  </span>
);

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
   *  number of moving marks in the scope it summarises. Omitted by a surface
   *  that carries this fact elsewhere — the host tab runs a stripe along its
   *  bottom edge instead. Omitted, never passed as a fabricated 0. */
  active?: number;
  /** Agents blocked on your input (`awaiting_user`). */
  asking: number;
  /** Finished terminals you have not opened. */
  unseen: number;
  /** You are LOOKING at this scope — unseen suppresses, because arriving is
   *  what clears it. The rule lives here, once, taking the surface's own
   *  `active` flag, rather than as an `active ? 0 : count` ternary at each
   *  call site. */
  viewing?: boolean;
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
  const unseen = () => (props.viewing ? 0 : props.unseen);
  const active = () => props.active ?? 0;
  return (
    <Show when={active() > 0 || props.asking > 0 || unseen() > 0}>
      <span
        class={`inline-flex shrink-0 items-center gap-1${props.class ? ` ${props.class}` : ""}`}
        data-testid="attention-triplet"
      >
        <Show when={active() > 0}>
          <span
            role="img"
            class={ACTIVE_COUNT_CLASS}
            title={`${active()} active${scope()}`}
            aria-label={`${active()} terminals active${scope()}`}
            data-testid="attention-active"
          >
            <WorkingArc />
            {active()}
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
          count={unseen()}
          class={`${UNSEEN_COUNT_CLASS} shrink-0 ${props.sizeClass}`}
          title={`${unseen()} finished, unseen${scope()}${props.onUnseen ? " — click to jump" : ""}`}
          ariaLabel={`${unseen()} finished terminals you haven't seen${scope()}`}
          testid="attention-unseen"
          onJump={props.onUnseen}
        />
      </span>
    </Show>
  );
};
