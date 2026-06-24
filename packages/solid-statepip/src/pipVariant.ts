/** The status-pip vocabulary + the shared agent-paint → pip fold + the two
 *  outer-layer folds the merged status indicator wraps around the core.
 *
 *  A `PipVariant` is the agent-state CORE the `StatePip` component switches
 *  over — the cross-surface vocabulary kolu's on-canvas **Dock** and the
 *  **pulam-web** fleet dashboard both speak, so a given agent state renders the
 *  IDENTICAL pip (glyph · colour · animation) on both. `StatePip` lives here, in
 *  a presentation leaf both surfaces import, rather than in `dock/` where it
 *  used to — location is structure.
 *
 *  The core is only ONE of three axes the indicator now folds into one glyph
 *  (R-activity-merge). The other two — terminal **liveness** (moving bytes) and
 *  an unread-notification **alert** — were each a SEPARATE dot before, defined
 *  (and drifting) per surface; they now compose here, once, as the indicator's
 *  outer layers via `indicatorWrapperClass`:
 *    - the live RING — a green `--color-ok` border, the old `LiveActivityDot`
 *      folded into the indicator's edge instead of a second dot beside it;
 *    - the alert HALO — an amber `--color-attention` ring + pulse, the Dock's
 *      old loud `attention` pip turned into a halo that WRAPS the live state
 *      core instead of REPLACING it (you read needs-attention AND the state).
 *  Both default off, so a bare `<StatePip variant=… />` reads exactly as before.
 *
 *  `pipForPaintClass` is the single definition of "which pip an agent's paint
 *  class shows", imported by BOTH the Dock's `pipVariant` and pulam-web's
 *  `pipVariantFor`, so the agent-paint → pip mapping can't be spelled — and
 *  drift — twice (the exact "defined twice → drifts" hazard R-pip-unify closes).
 *  Each surface layers only its OWN core overlays on top: the Dock adds
 *  `parked`→empty and its deliberate `sleeping`; pulam-web adds structural
 *  sleeping (no agent + no foreground). Neither surface's local triage concepts
 *  leak in here. So the IDENTICAL-pip guarantee is precisely for **agent**
 *  states (everything the shared fold decides); the **non-agent** overlays
 *  deliberately diverge — a touched-but-idle shell paints `idle` on the Dock
 *  (folded on recency) but `sleeping` on pulam-web (folded on foreground), by
 *  design, because each surface owns what an agentless terminal means to it.
 *
 *  This module is exposed on its OWN `./pipVariant` subpath (the same shape
 *  `@kolu/solid-pierre` uses for its `./paths` reconcile fold), so the pure-logic
 *  consumers — the Dock's `pipVariant`, pulam-web's `pipVariantFor`, and their
 *  unit tests — import the fold WITHOUT pulling in `StatePip` (the barrel's JSX),
 *  which a node-environment Vitest can't transform out of a workspace dependency.
 *  The rendering call sites import `StatePip` from the barrel; the two entry
 *  points are a deliberate value/JSX split, not redundancy. */

import type { AgentPaintClass } from "@kolu/terminal-workspace/agentProjection";

export type PipVariant =
  | "awaiting" // awaiting, already seen: quiet dim dot (lingering)
  | "working" // hollow spinning ring
  | "idle" // muted small dot
  | "sleeping" // dormant: moonlit ☾ glyph
  | "empty"; // parked / none — render nothing

/** The shared agent-paint → pip fold. Speaks only the three agent paint classes
 *  (`@kolu/terminal-workspace/agentProjection`'s `AgentPaintClass`): `none` (no
 *  agent paint) renders nothing — a surface that wants a muted dot for a
 *  touched-but-agentless terminal maps that case itself (the Dock's `idle`,
 *  pulam-web's nonagent), it does not belong to the agent-paint vocabulary.
 *  Exhaustive with a `satisfies never` fence so a new paint class forces a pip
 *  decision HERE, in the one shared definition. */
export function pipForPaintClass(paint: AgentPaintClass): PipVariant {
  switch (paint) {
    case "working":
      return "working";
    case "awaiting":
      return "awaiting";
    case "none":
      return "empty";
    default:
      paint satisfies never;
      return "empty";
  }
}

/** The rendered body for each variant — the inner span's Tailwind class set and,
 *  for `sleeping`, its glyph. This is the per-variant LOOK as data, the single
 *  source `StatePip` renders from, so the agreed appearance is pinned by a pure
 *  test (`pipVariant.test.ts`) rather than living only inside JSX where a class
 *  edit (e.g. `working`'s `border-accent` → `border-busy`) would slip past every
 *  test. `null` is a variant that renders nothing inside the cell (`empty`).
 *  Colours are `@kolu/theme` tokens (`bg-alert`, `border-accent`, `bg-fg-3`,
 *  `text-moonlit`) so both surfaces resolve them identically; the pulse/spin
 *  carry `motion-reduce:animate-none` so the pip holds still under a
 *  reduced-motion preference on every consumer. */
export type PipBody = { class: string; glyph?: string };

export const PIP_BODY: Record<PipVariant, PipBody | null> = {
  // awaiting, already seen: quiet dim dot (lingering)
  awaiting: { class: "w-1.5 h-1.5 rounded-full bg-alert/55" },
  // working: hollow spinning ring
  working: {
    class:
      "w-2.5 h-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin motion-reduce:animate-none",
  },
  // idle: muted small dot
  idle: { class: "w-1.5 h-1.5 rounded-full bg-fg-3/55" },
  // dormant: moonlit ☾ glyph — visually distinct from the agent shapes and the
  // parked-drop; `text-moonlit` is the shared fixed sleeping accent.
  sleeping: { class: "text-[0.7rem] leading-none text-moonlit", glyph: "☾" },
  // parked / none — render nothing inside the cell
  empty: null,
};

/** The hover-title for each variant (a11y/affordance). Pure data so it stays
 *  beside `PIP_BODY` and out of the JSX. */
export const PIP_TITLES: Record<PipVariant, string> = {
  awaiting: "Awaiting input",
  working: "Working",
  idle: "Idle",
  sleeping: "Sleeping",
  empty: "",
};

/** The merged status indicator's WRAPPER — the fixed-size circle the state core
 *  sits centred inside, carrying the two outer axes the indicator folds in
 *  (R-activity-merge). The single source for both the Dock's and pulam-web's
 *  ring + halo, so the two surfaces can't drift.
 *
 *  Both axes draw as BOX-SHADOW rings — NOT a `border` for one and a `ring` for
 *  the other, which put them at different radii (a border sits *inside* the box,
 *  a box-shadow *outside* it), so a live row's ring and an alert row's halo had
 *  visibly different diameters. A box-shadow hugs the box edge and lives outside
 *  the layout box, so:
 *    - a single axis draws ONE 2px ring at the edge — the SAME diameter whether
 *      it's the green `--color-ok` live ring (moving bytes) or the amber
 *      `--color-attention` alert halo (a fired notification), so the column
 *      reads consistently row to row;
 *    - both axes NEST — green inner (2px), amber just outside it (4px) — so the
 *      live state and the unread obligation stay legible at once.
 *  The box itself is a fixed size with NO border, so the core never shifts as the
 *  axes flip, and with neither axis the wrapper is invisible (just reserves the
 *  column). `indicatorWrapperClass` carries the size + the reduced-motion-safe
 *  alert pulse; `indicatorWrapperStyle` carries the ring colours. */
export const INDICATOR_BASE =
  "flex flex-none items-center justify-center w-[18px] h-[18px] rounded-full";

/** The wrapper's class set — fixed size + the alert pulse. The ring COLOURS live
 *  in `indicatorWrapperStyle` (a box-shadow), kept off the class string because a
 *  two-ring live+alert shadow can't be spelled with a single Tailwind `ring-*`. */
export function indicatorWrapperClass(alert: boolean): string {
  return [INDICATOR_BASE, alert ? "motion-safe:animate-pulse" : ""]
    .filter(Boolean)
    .join(" ");
}

/** The wrapper's box-shadow — the live RING and the alert HALO as concentric
 *  rings at a consistent radius (see `INDICATOR_BASE`'s note). `""` when neither
 *  axis is set. Colours are the shared `@kolu/theme` CSS vars, so both surfaces
 *  resolve them identically (the var, not a hex — single-sourced, no drift). */
export function indicatorWrapperStyle(live: boolean, alert: boolean): string {
  const rings: string[] = [];
  if (live) rings.push("0 0 0 2px var(--color-ok)");
  if (alert) rings.push(`0 0 0 ${live ? "4px" : "2px"} var(--color-attention)`);
  return rings.length > 0 ? `box-shadow:${rings.join(",")}` : "";
}
