/** The shared status pip — kolu's on-canvas **Dock** and the **pulam-web** fleet
 *  dashboard both render THIS component, so a given `PipVariant` shows the
 *  identical glyph, colour, and animation on both surfaces. Shape carries the
 *  state distinction (filled disk vs hollow ring vs muted dot vs ☾) so the rule
 *  survives reduced colour sensitivity and a peripheral glance — not colour and
 *  animation alone.
 *
 *  Pure presentation: it takes a PRECOMPUTED `variant` and renders. Each surface
 *  owns its own state→variant mapping (the Dock's `pipVariant`, pulam-web's
 *  `pipVariantFor`), both folding the shared agent-paint classes through
 *  `pipForPaintClass`. Colours are the shared `@kolu/theme` tokens (`bg-alert`,
 *  `border-accent`, `bg-fg-3`, `text-moonlit`), so both surfaces — which each
 *  `@import "@kolu/theme/theme.css"` — resolve them identically.
 *
 *  The pulse/spin animations carry `motion-reduce:animate-none`, so a
 *  `prefers-reduced-motion: reduce` preference holds the pip still on EVERY
 *  consumer (shape + colour still convey the state) — the behaviour is owned
 *  here once, not re-spelled per surface. */

import { type Component, createMemo, Match, Switch } from "solid-js";
import type { PipVariant } from "./pipVariant.ts";

const PIP_TITLES: Record<PipVariant, string> = {
  attention: "Needs attention",
  awaiting: "Awaiting input",
  working: "Working",
  idle: "Idle",
  sleeping: "Sleeping",
  empty: "",
};

export const StatePip: Component<{ variant: PipVariant }> = (props) => {
  // Read `props.variant` ONCE per change. Callers pass the variant as a JSX-prop
  // expression (`pipVariantFor(value())` / `pipVariant(props.pip, unread())`),
  // which Solid compiles to a getter that re-runs its fold on every access — and
  // the cell below reads the variant at 7 sites (`data-pip`, `title`, and the
  // five `<Match>` guards `Switch` walks). The memo collapses those to one fold
  // per change on every consumer (it carries the original dock `StatePip`'s memo
  // forward across the lift), so a hot fleet/dock row doesn't re-run the
  // state→variant mapping 3–7× per tick.
  const variant = createMemo(() => props.variant);
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
      <Switch fallback={null}>
        <Match when={variant() === "attention"}>
          <span class="w-2 h-2 rounded-full bg-alert animate-pulse motion-reduce:animate-none ring-4 ring-alert/25" />
        </Match>
        <Match when={variant() === "awaiting"}>
          <span class="w-1.5 h-1.5 rounded-full bg-alert/55" />
        </Match>
        <Match when={variant() === "working"}>
          <span class="w-2.5 h-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin motion-reduce:animate-none" />
        </Match>
        <Match when={variant() === "idle"}>
          <span class="w-1.5 h-1.5 rounded-full bg-fg-3/55" />
        </Match>
        <Match when={variant() === "sleeping"}>
          {/* Moonlit ☾ — a deliberate dormant state, visually distinct from the
           *  agent shapes and from the parked-drop. `text-moonlit` is the shared
           *  fixed sleeping accent (no light-mode override). */}
          <span class="text-[0.7rem] leading-none text-moonlit">☾</span>
        </Match>
      </Switch>
    </span>
  );
};
