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
 *  (and drifting) per surface; they now compose here, once, as overlay elements
 *  (`LIVE_RING_CLASS`, `ALERT_BADGE_CLASS`; visuals in `statepip.css`):
 *    - the live RING — a thin green `--color-ok` arc that gently sweeps, the old
 *      `LiveActivityDot` folded into the indicator's edge instead of a second
 *      dot beside it;
 *    - the alert BADGE — a small amber `--color-attention` corner badge, the
 *      Dock's old loud `attention` pip retired: a different SHAPE from the ring
 *      (not another circle/halo), so the two never compound into nested rings,
 *      and the live state core stays fully visible.
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

import type { AgentPaintClass } from "@kolu/pulam-library/agentProjection";

export type PipVariant =
  | "awaiting" // awaiting, already seen: quiet dim dot (lingering)
  | "working" // hollow spinning ring
  | "idle" // muted small dot
  | "sleeping" // dormant: moonlit ☾ glyph
  | "empty"; // parked / none — render nothing

/** The shared agent-paint → pip fold. Speaks only the three agent paint classes
 *  (`@kolu/pulam-library/agentProjection`'s `AgentPaintClass`): `none` (no
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

/** The merged status indicator's leaf-intrinsic WRAPPER class — content-sized
 *  (no fixed box, so it fits whatever text/gap context the surface drops it in),
 *  and the positioning context for the two outer-axis overlays (R-activity-merge).
 *  `relative` so the live ring + alert badge (absolutely positioned, see
 *  `@kolu/solid-statepip/statepip.css`) anchor to it; `flex-none` so it never
 *  stretches or shrinks beside flexed siblings. A surface that reserves a
 *  fixed-size column passes that box in via `StatePip`'s `class` prop (the dock
 *  rows / fleet rows use `DOCK_ROW_PIP_BOX`); the leaf itself owns no surface
 *  geometry. */
export const INDICATOR_BASE =
  "relative inline-flex flex-none items-center justify-center";

/** The dock-row / fleet-row pip BOX — the fixed 18 px circle a surface that
 *  reserves a column passes to `StatePip` via its `class` prop. 18 px matches the
 *  `DOCK_ROW_GRID` leading track, so the indicator never shifts as the axes flip
 *  and an axis-less pip is an invisible box that still reserves the column. Lives
 *  here beside `INDICATOR_BASE` so the box and the leaf stay co-described, but it
 *  is a CALLER's geometry, not the leaf's — non-row callers (the tile title, the
 *  workspace column header) pass nothing and get an intrinsically-sized pip. */
export const DOCK_ROW_PIP_BOX = "w-[18px] h-[18px] rounded-full";

/** The tile-title pip BOX — a smaller fixed circle the canvas title bar passes to
 *  `StatePip`. The title pip carries the `alert` BADGE (the row's `unread`), and
 *  the badge anchors to the wrapper's top-right corner; a content-sized wrapper
 *  for a 6 px core would pin that 6 px badge ON the core and bury it. A reserved
 *  14 px box gives the core (≤10 px, centred) clearance so the corner badge reads
 *  beside it, not over it — sized to the `text-xs` annotation row it leads rather
 *  than the taller dock-row track. Caller's geometry, same as `DOCK_ROW_PIP_BOX`. */
export const TITLE_PIP_BOX = "w-[14px] h-[14px] rounded-full";

/** The live RING overlay class — a thin green arc that gently rotates while the
 *  terminal is moving bytes (the old standalone live dot, folded into the
 *  indicator's edge). The visual (conic-gradient + mask + spin) lives in
 *  `statepip.css`; both surfaces import it, so it can't drift. */
export const LIVE_RING_CLASS = "statepip-live-ring";

/** The alert overlay class — a small amber CORNER BADGE (top-right), not a ring:
 *  a surrounding alert ring (especially nested with the live ring) read as
 *  overwhelming, so the alert uses a different shape that never competes with the
 *  live ring. What the badge MEANS is the surface's to name (`StatePip`'s
 *  `alertLabel`): the Dock's unopened-unread, pulam-web's live notify-class. The
 *  visual lives in `statepip.css`. */
export const ALERT_BADGE_CLASS = "statepip-alert-badge";
