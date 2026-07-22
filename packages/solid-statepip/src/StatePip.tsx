/** The shared status indicator — kolu's on-canvas **Dock** renders THIS
 *  component, and it stays renderer-agnostic so any fleet mirror shows the
 *  identical glyph, colour, and animation for a given (state, motion, live,
 *  alert, identity) tuple.
 *
 *  Option C axes:
 *    - `glyph` — identity (who is driving)
 *    - `variant` — paint (agent state colour)
 *    - `motion` — activity channel (spin / glow / none); callers fold
 *      working∨live∨(waiting∧¬finished) into the kind
 *    - `live` — green plate behind the glyph (static live/active mark) plus
 *      accessible "live output" label; motion still layers on top
 *    - `alert` — unread obligation badge (amber)
 *
 *  Shape no longer encodes state. Under `prefers-reduced-motion` awaiting keeps
 *  a violet hollow outline and motion freezes; the plate stays (static green). */

import { type Component, createMemo, For, Show } from "solid-js";
import {
  ALERT_BADGE_CLASS,
  GLYPH_SVG_CLASS,
  INDICATOR_BASE,
  LIVE_RING_CLASS,
  PIP_BODY,
  PIP_MOTION_CLASS,
  PIP_TITLES,
  type PipGlyphDef,
  type PipGlyphId,
  type PipMotionKind,
  type PipVariant,
  SHELL_LIVE_CLASS,
  pipGlyph,
} from "./pipVariant.ts";

/** Render a pip identity mark — filled brand path or stroked shell prompt. */
const GlyphSvg: Component<{ def: PipGlyphDef }> = (props) => {
  const stroked = () => props.def.paint === "stroke";
  return (
    <svg
      class={GLYPH_SVG_CLASS}
      viewBox={props.def.viewBox}
      fill={stroked() ? "none" : "currentColor"}
      stroke={stroked() ? "currentColor" : undefined}
      stroke-width={stroked() ? (props.def.strokeWidth ?? 2.8) : undefined}
      stroke-linecap={stroked() ? "round" : undefined}
      stroke-linejoin={stroked() ? "round" : undefined}
      aria-hidden="true"
    >
      <For each={props.def.paths}>{(d) => <path d={d} />}</For>
    </svg>
  );
};

export const StatePip: Component<{
  variant: PipVariant;
  /** Who is driving this terminal — agent brand mark, or `"shell"`. Defaults
   *  to shell. */
  glyph?: PipGlyphId;
  /** Activity motion channel. Callers compute via `pipMotionKind` (dock).
   *  Default `"none"` (still). */
  motion?: PipMotionKind;
  /** Effectively active — working ∨ live output ∨ (waiting ∧ ¬EF2 finished).
   *  Lights the green live plate (static presence; motion is separate) and
   *  folds into the accessible label as "live output". */
  live?: boolean;
  /** Unread obligation corner badge (amber). Needs-you is paint/glow, not this. */
  alert?: boolean;
  alertLabel?: string;
  class?: string;
}> = (props) => {
  const variant = createMemo(() => props.variant);
  const glyphId = createMemo((): PipGlyphId => props.glyph ?? "shell");
  const body = createMemo(() => PIP_BODY[variant()]);
  const def = createMemo(() => pipGlyph(glyphId()));
  const motionKind = createMemo((): PipMotionKind => props.motion ?? "none");
  const label = createMemo(() => {
    const parts = [
      PIP_TITLES[variant()],
      props.live && "live output",
      props.alert && (props.alertLabel ?? "alert"),
    ].filter((p): p is string => Boolean(p));
    return parts.join(" · ");
  });
  const coreClass = createMemo(() => {
    const b = body();
    if (!b) return null;
    // One shell tier: quiet shell → fg-3; live output → busy orange (same as a
    // working agent). No mid tier for "foreground present" — the sub-line names
    // the process in words. Motion layers on top so live shells still spin.
    let paint = b.class;
    if (glyphId() === "shell" && variant() === "idle" && props.live) {
      paint = SHELL_LIVE_CLASS;
    }
    const motion = PIP_MOTION_CLASS[motionKind()];
    return motion ? `${paint} ${motion}` : paint;
  });
  return (
    <span
      class={props.class ? `${INDICATOR_BASE} ${props.class}` : INDICATOR_BASE}
      data-testid="state-pip"
      data-pip={variant()}
      data-glyph={glyphId()}
      data-motion={motionKind()}
      data-live={props.live ? "" : undefined}
      data-alert={props.alert ? "" : undefined}
      title={label() || undefined}
      role="img"
      aria-label={label() || undefined}
      aria-hidden={label() ? undefined : "true"}
    >
      {/* Live plate always when live — static green presence; motion on glyph. */}
      <Show when={props.live}>
        <span class={LIVE_RING_CLASS} aria-hidden="true" />
      </Show>
      <Show when={coreClass()}>
        {(cls) => (
          <span class={`relative flex items-center justify-center ${cls()}`}>
            <GlyphSvg def={def()} />
          </span>
        )}
      </Show>
      <Show when={props.alert}>
        <span class={ALERT_BADGE_CLASS} aria-hidden="true" />
      </Show>
    </span>
  );
};
