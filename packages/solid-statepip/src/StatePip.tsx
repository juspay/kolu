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
 *    - `live` (the RING) — this terminal is moving bytes right now (the old
 *      `LiveActivityDot`, folded into the indicator's green edge).
 *    - `alert` (the HALO) — a fired notification you haven't opened (the Dock's
 *      `unread`, pulam-web's notify-class). An amber halo wraps the whole thing
 *      while the state core stays visible underneath — needs-attention AND the
 *      live state at once, not a loud disk that hides the state.
 *
 *  Pure presentation: the per-variant CORE class set lives in `PIP_BODY` and the
 *  ring/halo class set in `indicatorWrapperClass`, both as data, so the agreed
 *  look is a single source pinned by a pure test (no DOM harness, matching the
 *  other `@kolu/solid-*` leaves). Colours are the shared `@kolu/theme` tokens, so
 *  both surfaces — which each `@import "@kolu/theme/theme.css"` — resolve them
 *  identically. */

import { type Component, createMemo, Show } from "solid-js";
import {
  indicatorWrapperClass,
  indicatorWrapperStyle,
  PIP_BODY,
  PIP_TITLES,
  type PipVariant,
} from "./pipVariant.ts";

export const StatePip: Component<{
  variant: PipVariant;
  /** Terminal moving bytes right now → the green live-output RING around the
   *  core. The activity dot, folded into the indicator's edge. Default off. */
  live?: boolean;
  /** A fired notification not yet opened → the amber ALERT HALO + pulse around
   *  the whole indicator (the Dock's `unread`, pulam-web's notify-class), the
   *  state core staying visible underneath. Default off. */
  alert?: boolean;
}> = (props) => {
  // Read each prop ONCE per change. Callers pass them as JSX-prop expressions
  // (`pipVariantFor(value())` / `activity.isLive(id)` / `unread()`), which Solid
  // compiles to getters re-running their fold on every access; the memos collapse
  // those to one fold per change on every consumer (carrying the original dock
  // `StatePip`'s memo forward across the lift).
  const variant = createMemo(() => props.variant);
  const body = createMemo(() => PIP_BODY[variant()]);
  const wrapperClass = createMemo(() =>
    indicatorWrapperClass(props.alert ?? false),
  );
  // The live ring + alert halo are box-shadow rings (one mechanism, one radius)
  // so they never disagree in diameter the way a border-ring + box-shadow-halo
  // did. Empty string when neither axis is set → no inline style.
  const wrapperStyle = createMemo(() =>
    indicatorWrapperStyle(props.live ?? false, props.alert ?? false),
  );
  return (
    // `data-testid="dock-row-pip"` is the established e2e selector, now spanning
    // all three surfaces this component renders on — the dock row pip, the canvas
    // tile-title pip, and the pulam-web fleet row pip (see
    // packages/tests/step_definitions); kept stable across the lift so the
    // scenarios keep matching. `data-live`/`data-alert` expose the outer axes for
    // tests/inspection.
    <span
      class={wrapperClass()}
      style={wrapperStyle()}
      data-testid="dock-row-pip"
      data-pip={variant()}
      data-live={props.live ? "" : undefined}
      data-alert={props.alert ? "" : undefined}
      title={PIP_TITLES[variant()]}
    >
      <Show when={body()}>
        {(b) => <span class={b().class}>{b().glyph}</span>}
      </Show>
    </span>
  );
};
