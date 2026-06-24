/** The shared status indicator — kolu's on-canvas **Dock** and the **pulam-web**
 *  fleet dashboard both render THIS component, so a given (state, live, alert)
 *  triple shows the identical glyph, colour, and animation on both surfaces.
 *  Shape carries the state distinction (hollow ring vs muted dot vs ☾) so the
 *  rule survives reduced colour sensitivity and a peripheral glance — not colour
 *  and animation alone.
 *
 *  Three nested axes in one glyph (R-activity-merge), so one look reads overall
 *  activity instead of scanning two or three separate dots:
 *    - `variant` (the CORE) — agent state, the precomputed `PipVariant`. Each
 *      surface owns its own state→variant mapping (the Dock's `pipVariant`,
 *      pulam-web's `pipVariantFor`), both folding the shared agent-paint classes
 *      through `pipForPaintClass`.
 *    - `live` (the RING) — this terminal is moving bytes right now: a thin green
 *      arc that gently sweeps around the core (the old `LiveActivityDot`, folded
 *      into the indicator's edge).
 *    - `alert` (the BADGE) — a fired notification you haven't opened (the Dock's
 *      `unread`, pulam-web's notify-class): a small amber corner badge, NOT a
 *      ring — a surrounding alert ring (especially nested with the live ring)
 *      read as overwhelming, so the two axes use different shapes and never
 *      compound into concentric circles. The state core stays fully visible.
 *
 *  Pure presentation: the per-variant CORE class set lives in `PIP_BODY`; the
 *  ring + badge are overlay elements whose class names (`LIVE_RING_CLASS`,
 *  `ALERT_BADGE_CLASS`) and visuals live in `statepip.css` (a conic-gradient +
 *  mask sweep, an absolutely-positioned badge — neither expressible as Tailwind
 *  utilities). Both surfaces `@import` that CSS, so the rings can't drift; the
 *  class data is pinned by a pure test (no DOM harness, matching the other
 *  `@kolu/solid-*` leaves). Colours are the shared `@kolu/theme` tokens, so both
 *  surfaces resolve them identically. */

import { type Component, createMemo, Show } from "solid-js";
import {
  ALERT_BADGE_CLASS,
  INDICATOR_BASE,
  LIVE_RING_CLASS,
  PIP_BODY,
  PIP_TITLES,
  type PipVariant,
} from "./pipVariant.ts";

export const StatePip: Component<{
  variant: PipVariant;
  /** Terminal moving bytes right now → the green live-output RING around the
   *  core. The activity dot, folded into the indicator's edge. Default off. */
  live?: boolean;
  /** A fired notification not yet opened → a small amber `--color-attention`
   *  corner badge (top-right), NOT a ring, so it never compounds with the live
   *  ring into nested circles; the state core stays fully visible (the Dock's
   *  `unread`, pulam-web's notify-class). Default off. */
  alert?: boolean;
}> = (props) => {
  // Read each prop ONCE per change. Callers pass them as JSX-prop expressions
  // (`pipVariantFor(value())` / `activity.isLive(id)` / `unread()`), which Solid
  // compiles to getters re-running their fold on every access; the memos collapse
  // those to one fold per change on every consumer (carrying the original dock
  // `StatePip`'s memo forward across the lift).
  const variant = createMemo(() => props.variant);
  const body = createMemo(() => PIP_BODY[variant()]);
  return (
    // `data-testid="state-pip"` is the surface-neutral e2e selector for this
    // shared leaf, spanning all three surfaces it renders on — the dock row pip,
    // the canvas tile-title pip, and the pulam-web fleet row pip (see
    // packages/tests/step_definitions). `data-live`/`data-alert` expose the outer
    // axes for tests/inspection.
    <span
      class={INDICATOR_BASE}
      data-testid="state-pip"
      data-pip={variant()}
      data-live={props.live ? "" : undefined}
      data-alert={props.alert ? "" : undefined}
      title={PIP_TITLES[variant()]}
    >
      <Show when={body()}>
        {(b) => <span class={b().class}>{b().glyph}</span>}
      </Show>
      {/* The two outer-axis overlays — a green arc that sweeps around the core
          while the terminal is live, and a small amber corner badge while an
          alert is unread (a badge, not a ring, so the two never compound into
          nested circles). Visuals in statepip.css. */}
      <Show when={props.live}>
        <span class={LIVE_RING_CLASS} aria-hidden="true" />
      </Show>
      <Show when={props.alert}>
        <span class={ALERT_BADGE_CLASS} aria-hidden="true" />
      </Show>
    </span>
  );
};
