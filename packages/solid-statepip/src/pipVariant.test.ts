import {
  type AgentPaintClass,
  agentPaintClass,
} from "@kolu/terminal-workspace/agentProjection";
import { describe, expect, it } from "vitest";
import {
  ALERT_BADGE_CLASS,
  DOCK_ROW_PIP_BOX,
  INDICATOR_BASE,
  LIVE_RING_CLASS,
  PIP_BODY,
  PIP_TITLES,
  type PipVariant,
  TITLE_PIP_BOX,
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

  it("the working spin animation is reduced-motion safe", () => {
    expect(PIP_BODY.working?.class).toContain("motion-reduce:animate-none");
  });

  it("sleeping is the only variant with a glyph (the ☾)", () => {
    expect(PIP_BODY.sleeping?.glyph).toBe("☾");
    for (const v of ["awaiting", "working", "idle"] as const) {
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

// The two OUTER axes the merged indicator folds around the core (R-activity-
// merge): the green live RING (a rotating arc) and the unread ALERT (a small
// amber corner badge — a different shape, so it never competes with the ring or
// nests into a second circle), drawn as overlay elements whose visuals live in
// statepip.css. Both surfaces (Dock + pulam-web) render the same component +
// import the same CSS, so this is the one definition — the "defined twice →
// drifts" hazard the two separate dots had, closed the way R-pip-unify closed it.
describe("the indicator wrapper + outer-axis overlays", () => {
  it("the leaf wrapper is a content-sized relative box (anchors the absolute overlays), no surface geometry", () => {
    const cls = INDICATOR_BASE.split(/\s+/);
    expect(cls).toContain("relative"); // positioning context for the overlays
    expect(cls).toContain("flex-none"); // never stretch/shrink beside flexed siblings
    // The leaf owns NO fixed box — a surface that reserves a column passes the
    // box in via `DOCK_ROW_PIP_BOX`, so an inline caller sizes to its own text.
    expect(cls).not.toContain("w-[18px]");
    expect(cls).not.toContain("border-2"); // no border — overlays carry the rings
  });

  it("DOCK_ROW_PIP_BOX is the caller-supplied 18px column box, not baked into the leaf", () => {
    const cls = DOCK_ROW_PIP_BOX.split(/\s+/);
    expect(cls).toContain("w-[18px]");
    expect(cls).toContain("h-[18px]");
    expect(cls).toContain("rounded-full");
  });

  it("TITLE_PIP_BOX is the smaller caller-supplied 14px box the tile title reserves so the alert badge anchors to a corner, not onto the core", () => {
    const cls = TITLE_PIP_BOX.split(/\s+/);
    expect(cls).toContain("w-[14px]");
    expect(cls).toContain("h-[14px]");
    expect(cls).toContain("rounded-full");
  });

  it("the live ring + alert badge are the shared statepip.css classes", () => {
    expect(LIVE_RING_CLASS).toBe("statepip-live-ring");
    // a badge, NOT a halo/ring — the alert uses a distinct shape so it never
    // compounds with the live ring into nested circles.
    expect(ALERT_BADGE_CLASS).toBe("statepip-alert-badge");
  });
});
