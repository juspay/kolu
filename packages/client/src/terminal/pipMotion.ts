/** Pure motion fold for every StatePip surface — activity is the motion channel.
 *
 *  Lives under `terminal/` (not `dock/`) because title chrome and the workspace
 *  switcher share it — location is structure (lens-debate).
 *
 *  Axis contract:
 *    identity → glyph shape
 *    state    → glyph paint (attentionClass → PipVariant)
 *    activity → glyph MOTION (this module)
 *    obligation → amber badge
 *    dormancy → row recedes (caller)
 *
 *  Motion kinds:
 *    - empty / sleeping / inactive → none
 *    - awaiting (needs-you variant) → glow
 *    - everything else active → spin
 *
 *  WHETHER the terminal is active is not decided here — it is
 *  `attentionActive`, the one predicate shared with every count kolu renders
 *  (see `attention/attentionFacts.ts`). This module only chooses which motion an
 *  active mark runs. Paint stays decoupled: a lingering agent keeps its dim
 *  violet via PipVariant `linger` whether or not it still moves. */

import type {
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";

/** Which motion class the glyph should run. Collapsed: inactive/empty/sleeping
 *  → none; active needs-you → glow; active otherwise → spin. The needs-you test
 *  is the VARIANT itself — `awaiting` now means exactly `awaiting_user` (the
 *  `linger` split), so motion no longer re-derives the state from the agent. */
export function pipMotionKind(input: {
  variant: PipVariant;
  active: boolean;
}): PipMotionKind {
  if (
    input.variant === "empty" ||
    input.variant === "sleeping" ||
    !input.active
  ) {
    return "none";
  }
  // Needs-you glows; working / linger-until-EF2 / live shell spin.
  if (input.variant === "awaiting") return "glow";
  return "spin";
}
