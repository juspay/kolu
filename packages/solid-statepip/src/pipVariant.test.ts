import {
  type AgentPaintClass,
  agentPaintClass,
} from "@kolu/terminal-workspace/agentProjection";
import { describe, expect, it } from "vitest";
import { type PipVariant, pipForPaintClass } from "./pipVariant.ts";

// The shared agent-paint → pip fold both kolu's Dock and the pulam-web fleet
// dashboard route through, so the pip a given agent paint class renders is
// defined ONCE here and cannot drift between the two surfaces.
const paintCases: Array<[AgentPaintClass, PipVariant]> = [
  ["working", "working"],
  ["awaiting", "awaiting"],
  ["none", "empty"],
];

describe("pipForPaintClass", () => {
  for (const [paint, expected] of paintCases) {
    it(`${paint} → ${expected}`, () => {
      expect(pipForPaintClass(paint)).toBe(expected);
    });
  }
});

// The cross-surface contract, stated as a test: a given agent STATE renders the
// same pip on the Dock and pulam-web, because both fold the state through the
// SAME `agentPaintClass` → `pipForPaintClass` path. `waiting` paints `awaiting`
// (the lingering "just finished" dot), not `idle` — order≠colour, the
// dock-fleet-mirror contract.
const stateCases: Array<[Parameters<typeof agentPaintClass>[0], PipVariant]> = [
  ["thinking", "working"],
  ["tool_use", "working"],
  ["running_background", "working"],
  ["awaiting_user", "awaiting"],
  ["waiting", "awaiting"],
];

describe("agent state → pip (shared Dock ≡ pulam-web path)", () => {
  for (const [state, expected] of stateCases) {
    it(`${state} → ${expected}`, () => {
      expect(pipForPaintClass(agentPaintClass(state))).toBe(expected);
    });
  }
});
