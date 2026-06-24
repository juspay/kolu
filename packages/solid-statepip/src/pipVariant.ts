/** The status-pip vocabulary + the shared agent-paint → pip fold.
 *
 *  A `PipVariant` is the ONE render variant the `StatePip` component switches
 *  over — the cross-surface vocabulary kolu's on-canvas **Dock** and the
 *  **pulam-web** fleet dashboard both speak, so a given agent state renders the
 *  IDENTICAL pip (glyph · colour · animation) on both. `StatePip` lives here, in
 *  a presentation leaf both surfaces import, rather than in `dock/` where it
 *  used to — location is structure.
 *
 *  `pipForPaintClass` is the single definition of "which pip an agent's paint
 *  class shows", imported by BOTH the Dock's `pipVariant` and pulam-web's
 *  `pipVariantFor`, so the agent-paint → pip mapping can't be spelled — and
 *  drift — twice (the exact "defined twice → drifts" hazard R-pip-unify closes).
 *  Each surface layers only its OWN overlays on top: the Dock adds
 *  `unread`→attention, `parked`→empty and its deliberate `sleeping`; pulam-web
 *  adds structural sleeping (no agent + no foreground). Neither surface's local
 *  triage concepts leak in here.
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
  | "attention" // unread: loud filled disk + halo + pulse
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
