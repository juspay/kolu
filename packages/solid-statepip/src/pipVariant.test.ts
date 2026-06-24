import {
  type AgentPaintClass,
  agentPaintClass,
} from "@kolu/terminal-workspace/agentProjection";
import { describe, expect, it } from "vitest";
import {
  PIP_BODY,
  PIP_TITLES,
  type PipVariant,
  pipForPaintClass,
} from "./pipVariant.ts";

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

// Pin the rendered LOOK of each variant — `StatePip` renders straight from
// `PIP_BODY`, so asserting the class set here catches an appearance regression
// (e.g. swapping `working`'s `border-accent` for `border-busy`, or `attention`
// losing its pulse) that the fold-string tests above would not. The shared
// `@kolu/theme` tokens it names (`bg-alert`/`border-accent`/`bg-fg-3`/
// `text-moonlit`) are what make the two surfaces resolve the same colour.
const bodyCases: Array<[PipVariant, string[]]> = [
  ["attention", ["bg-alert", "animate-pulse", "ring-alert/25"]],
  ["awaiting", ["bg-alert/55"]],
  ["working", ["border-accent", "border-t-transparent", "animate-spin"]],
  ["idle", ["bg-fg-3/55"]],
  ["sleeping", ["text-moonlit"]],
];

describe("PIP_BODY — the rendered class set per variant", () => {
  for (const [variant, tokens] of bodyCases) {
    it(`${variant} carries ${tokens.join(" + ")}`, () => {
      const body = PIP_BODY[variant];
      expect(body, `${variant} should render a body`).not.toBeNull();
      for (const token of tokens) {
        expect(body?.class.split(/\s+/)).toContain(token);
      }
    });
  }

  it("the pulse/spin animations are reduced-motion safe", () => {
    expect(PIP_BODY.attention?.class).toContain("motion-reduce:animate-none");
    expect(PIP_BODY.working?.class).toContain("motion-reduce:animate-none");
  });

  it("sleeping is the only variant with a glyph (the ☾)", () => {
    expect(PIP_BODY.sleeping?.glyph).toBe("☾");
    for (const v of ["attention", "awaiting", "working", "idle"] as const) {
      expect(PIP_BODY[v]?.glyph).toBeUndefined();
    }
  });

  it("empty renders nothing inside the cell", () => {
    expect(PIP_BODY.empty).toBeNull();
  });

  it("every variant has a hover title (empty's is blank)", () => {
    for (const v of Object.keys(PIP_BODY) as PipVariant[]) {
      expect(typeof PIP_TITLES[v]).toBe("string");
    }
    expect(PIP_TITLES.empty).toBe("");
    expect(PIP_TITLES.working).toBe("Working");
  });
});
