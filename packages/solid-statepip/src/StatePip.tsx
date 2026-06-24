/** The shared status pip — kolu's on-canvas **Dock** and the **pulam-web** fleet
 *  dashboard both render THIS component, so a given `PipVariant` shows the
 *  identical glyph, colour, and animation on both surfaces. Shape carries the
 *  state distinction (filled disk vs hollow ring vs muted dot vs ☾) so the rule
 *  survives reduced colour sensitivity and a peripheral glance — not colour and
 *  animation alone.
 *
 *  Pure presentation: it takes a PRECOMPUTED `variant` and renders the matching
 *  entry from `PIP_BODY` — the per-variant class set lives there, as data, so the
 *  agreed look is a single source pinned by a pure test (no DOM harness, matching
 *  the other `@kolu/solid-*` leaves). Each surface owns its own state→variant
 *  mapping (the Dock's `pipVariant`, pulam-web's `pipVariantFor`), both folding
 *  the shared agent-paint classes through `pipForPaintClass`. Colours are the
 *  shared `@kolu/theme` tokens, so both surfaces — which each
 *  `@import "@kolu/theme/theme.css"` — resolve them identically. */

import { type Component, createMemo, Show } from "solid-js";
import { PIP_BODY, PIP_TITLES, type PipVariant } from "./pipVariant.ts";

export const StatePip: Component<{ variant: PipVariant }> = (props) => {
  // Read `props.variant` ONCE per change. Callers pass the variant as a JSX-prop
  // expression (`pipVariantFor(value())` / `pipVariant(props.pip, unread())`),
  // which Solid compiles to a getter re-running its fold on every access, and the
  // cell reads it at `data-pip`, `title`, and the body lookup. The memo collapses
  // those to one fold per change on every consumer (carrying the original dock
  // `StatePip`'s memo forward across the lift).
  const variant = createMemo(() => props.variant);
  const body = createMemo(() => PIP_BODY[variant()]);
  return (
    // `data-testid="dock-row-pip"` is the established e2e selector, now spanning
    // all three surfaces this component renders on — the dock row pip, the canvas
    // tile-title pip, and the pulam-web fleet row pip (see
    // packages/tests/step_definitions); kept stable across the lift so the
    // scenarios keep matching.
    <span
      class="flex items-center justify-center"
      data-testid="dock-row-pip"
      data-pip={variant()}
      title={PIP_TITLES[variant()]}
    >
      <Show when={body()}>
        {(b) => <span class={b().class}>{b().glyph}</span>}
      </Show>
    </span>
  );
};
