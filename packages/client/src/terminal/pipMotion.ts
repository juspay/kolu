/** Pure motion fold for every StatePip surface — activity is the motion channel.
 *
 *  Lives under `terminal/` (not `dock/`) because title chrome and the workspace
 *  switcher share it — location is structure (lens-debate).
 *
 *  Axis contract:
 *    identity → glyph shape
 *    state    → glyph paint (agentPaintClass → PipVariant)
 *    activity → glyph MOTION (this module)
 *    obligation → amber badge
 *    dormancy → row recedes (caller)
 *
 *  Motion kinds (derived from `pipIsActive`, not re-encoded per bucket):
 *    - empty / sleeping / inactive → none
 *    - awaiting_user (active) → glow
 *    - everything else active → spin
 *
 *  Paint stays decoupled: waiting keeps lingering violet via PipVariant
 *  `awaiting` even when motion holds still. */

import type {
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import { agentBucket, type AgentInfo } from "kolu-common/surface";

/** Whether the terminal is "effectively active" for motion — complement of
 *  EF2 effective finish for waiting agents (OR live output: sticky finish
 *  must not silence a still-printing terminal); live-output for shells;
 *  always for working / awaiting_user. Also gates recency-cell hide.
 *  Exhaustive over `agentBucket` (`case "other"`, no bare default). */
export function pipIsActive(input: {
  agent: AgentInfo | null | undefined;
  isLive: boolean;
  isFinished: boolean;
}): boolean {
  const agent = input.agent;
  if (!agent) return input.isLive;
  switch (agentBucket(agent.state)) {
    case "working":
    case "awaiting":
      return true;
    case "waiting":
      // EF2 linger until quiet, OR live output once sticky-finish latches
      // (finishedIds answers chime; isLive answers motion — #1955).
      return !input.isFinished || input.isLive;
    case "other":
      return input.isLive;
  }
}

/** Which motion class the glyph should run. Collapsed: inactive/empty/sleeping
 *  → none; active needs-you → glow; active otherwise → spin. */
export function pipMotionKind(input: {
  variant: PipVariant;
  agent: AgentInfo | null | undefined;
  active: boolean;
}): PipMotionKind {
  if (
    input.variant === "empty" ||
    input.variant === "sleeping" ||
    !input.active
  ) {
    return "none";
  }
  // Needs-you (awaiting_user) glows; working / waiting-until-EF2 / live shell spin.
  if (input.agent && agentBucket(input.agent.state) === "awaiting") {
    return "glow";
  }
  return "spin";
}
