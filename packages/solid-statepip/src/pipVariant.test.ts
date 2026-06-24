import {
  type AgentPaintClass,
  agentPaintClass,
} from "@kolu/terminal-workspace/agentProjection";
import { describe, expect, it } from "vitest";
import {
  indicatorWrapperClass,
  indicatorWrapperStyle,
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
// merge): the green live RING and the amber unread HALO. The class carries the
// fixed size + the alert pulse; the ring COLOURS are a box-shadow style. Both
// surfaces (Dock + pulam-web) render the same component, so this is the one
// definition — the "defined twice → drifts" hazard the two separate dots had,
// closed the way R-pip-unify closed it for the core pip.
describe("indicatorWrapperClass — fixed size + the alert pulse", () => {
  it("quiet: a fixed box, no pulse, NO border (rings are box-shadow)", () => {
    const cls = indicatorWrapperClass(false).split(/\s+/);
    expect(cls).toContain("w-[18px]");
    expect(cls).toContain("h-[18px]");
    expect(cls).toContain("rounded-full");
    expect(cls).not.toContain("motion-safe:animate-pulse");
    expect(indicatorWrapperClass(false)).not.toContain("border");
  });

  it("alert: adds the reduced-motion-safe pulse", () => {
    expect(indicatorWrapperClass(true).split(/\s+/)).toContain(
      "motion-safe:animate-pulse",
    );
  });

  it("the box is fixed-size so the core never shifts as the axes flip", () => {
    for (const alert of [false, true]) {
      const cls = indicatorWrapperClass(alert).split(/\s+/);
      expect(cls).toContain("w-[18px]");
      expect(cls).toContain("h-[18px]");
    }
  });
});

// The ring geometry — the live ring (`--color-ok`) and the alert halo
// (`--color-attention`) as box-shadows. Both are drawn the SAME way (a box-shadow
// hugging the box edge) so a single axis renders at one consistent radius — the
// bug this closed was a `border` live-ring (inside the box) vs a `ring-2` halo
// (outside it) reading at visibly different diameters. Colours are the shared
// `@kolu/theme` vars so the two surfaces resolve them identically.
describe("indicatorWrapperStyle — live ring + alert halo, consistent radius", () => {
  it("neither axis → no box-shadow", () => {
    expect(indicatorWrapperStyle(false, false)).toBe("");
  });

  it("live only → one green --color-ok ring at 2px", () => {
    expect(indicatorWrapperStyle(true, false)).toBe(
      "box-shadow:0 0 0 2px var(--color-ok)",
    );
  });

  it("alert only → one amber --color-attention ring at 2px", () => {
    expect(indicatorWrapperStyle(false, true)).toBe(
      "box-shadow:0 0 0 2px var(--color-attention)",
    );
  });

  it("a single axis draws its ring at the SAME radius — consistent diameter row to row", () => {
    const liveWidth = indicatorWrapperStyle(true, false).match(
      /0 0 0 (\S+) var/,
    )?.[1];
    const alertWidth = indicatorWrapperStyle(false, true).match(
      /0 0 0 (\S+) var/,
    )?.[1];
    expect(liveWidth).toBe("2px");
    expect(alertWidth).toBe("2px");
    expect(liveWidth).toBe(alertWidth);
  });

  it("both axes nest — green inner (2px), amber just outside (4px)", () => {
    expect(indicatorWrapperStyle(true, true)).toBe(
      "box-shadow:0 0 0 2px var(--color-ok),0 0 0 4px var(--color-attention)",
    );
  });
});
