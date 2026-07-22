/** Pure motion fold for dock / title StatePips — activity is the motion channel.
 *
 *  Axis contract (see #1949 identity, this PR for motion):
 *    identity → glyph shape
 *    state    → glyph paint (agentPaintClass → PipVariant)
 *    activity → glyph MOTION (this module)
 *    obligation → amber badge
 *    dormancy → row recedes (caller)
 *
 *  Motion kinds:
 *    - working → always breathe
 *    - awaiting_user → always glow ("calling you" ranks above breathe)
 *    - waiting → breathe until effectively finished (EF2 `finishedIds`), then still
 *    - shell / idle → breathe while live output, still otherwise
 *
 *  Paint stays decoupled: waiting keeps lingering violet via PipVariant
 *  `awaiting` even when motion holds still. */

import type { PipVariant } from "@kolu/solid-statepip/pipVariant";
import { agentBucket, type AgentInfo } from "kolu-common/surface";

export type PipMotionKind = "breathe" | "glow" | "none";

/** Whether the terminal is "effectively active" for motion — complement of
 *  EF2 effective finish for waiting agents; live-output for shells; always
 *  for working / awaiting_user. */
export function pipIsActive(input: {
  agent: AgentInfo | null | undefined;
  isLive: boolean;
  isFinished: boolean;
}): boolean {
  const agent = input.agent;
  if (!agent) return input.isLive;
  switch (agentBucket(agent.state)) {
    case "working":
      return true;
    case "awaiting":
      // Needs-you is always "active" for the glow channel.
      return true;
    case "waiting":
      return !input.isFinished;
    default:
      return input.isLive;
  }
}

/** Which motion class the glyph should run, given paint variant + agent bucket
 *  + activity. Exhaustive over the agent buckets we care about; pure for tests. */
export function pipMotionKind(input: {
  variant: PipVariant;
  agent: AgentInfo | null | undefined;
  active: boolean;
}): PipMotionKind {
  if (input.variant === "empty" || input.variant === "sleeping") return "none";

  const agent = input.agent;
  if (agent) {
    switch (agentBucket(agent.state)) {
      case "working":
        return "breathe";
      case "awaiting":
        return "glow";
      case "waiting":
        // Lingering violet paint (variant awaiting) + breathe until EF2 quiet.
        return input.active ? "breathe" : "none";
      default:
        return input.active ? "breathe" : "none";
    }
  }

  // Shell / agentless: breathe while live, still otherwise.
  if (input.variant === "working") return "breathe";
  if (input.variant === "awaiting") return input.active ? "glow" : "none";
  return input.active ? "breathe" : "none";
}
