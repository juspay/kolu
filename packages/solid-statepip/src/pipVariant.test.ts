import {
  type AgentPaintClass,
  agentPaintClass,
} from "@kolu/terminal-vocab/agentProjection";
import type { AgentKind } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  ALERT_BADGE_CLASS,
  ATTENTION_PILL_CLASS,
  DOCK_ROW_PIP_BOX,
  GLYPH_SVG_CLASS,
  INDICATOR_BASE,
  LIVE_RING_CLASS,
  PIP_BODY,
  PIP_MOTION,
  PIP_TITLES,
  type PipVariant,
  SHELL_BUSY_CLASS,
  TITLE_PIP_BOX,
  agentGlyph,
  pipForPaintClass,
  pipGlyph,
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
// (the lingering "just finished" cue), not `idle` — order≠colour, the
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

// Paint and motion are separate so a post-turn `waiting` agent can keep the
// lingering violet paint (agentPaintClass → awaiting) while holding still.
const bodyCases: Array<[PipVariant, string[]]> = [
  ["awaiting", ["text-alert/55"]],
  ["working", ["text-accent"]],
  ["idle", ["text-fg-3"]],
  ["sleeping", ["text-moonlit/65"]],
];

describe("PIP_BODY — paint only per variant", () => {
  for (const [variant, tokens] of bodyCases) {
    it(`${variant} carries ${tokens.join(" + ")}`, () => {
      const body = PIP_BODY[variant];
      expect(body, `${variant} should render a body`).not.toBeNull();
      for (const token of tokens) {
        expect(body?.class.split(/\s+/)).toContain(token);
      }
      // Motion is not mixed into paint.
      expect(body?.class).not.toMatch(/statepip-anim-/);
    });
  }

  it("sleeping is moonlit paint only — stillness is no motion, not a ☾ glyph", () => {
    expect(PIP_BODY.sleeping).toEqual({ class: "text-moonlit/65" });
    expect(PIP_MOTION.sleeping).toBeNull();
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

  it("SHELL_BUSY_CLASS brightens the idle shell mark", () => {
    expect(SHELL_BUSY_CLASS).toBe("text-fg-2");
  });
});

describe("PIP_MOTION — layered on paint unless still", () => {
  it("working breathes; awaiting glows; idle/sleeping are still", () => {
    expect(PIP_MOTION.working).toContain("statepip-anim-breathe");
    expect(PIP_MOTION.working).toContain("motion-reduce:animate-none");
    expect(PIP_MOTION.awaiting).toContain("statepip-anim-glow");
    expect(PIP_MOTION.awaiting).toContain("statepip-awaiting-core");
    expect(PIP_MOTION.awaiting).toContain("motion-reduce:animate-none");
    expect(PIP_MOTION.idle).toBeNull();
    expect(PIP_MOTION.sleeping).toBeNull();
  });
});

// Identity glyph record — fenced over AgentKind. A new kind without a mark is a
// compile error in agentGlyph; this test pins that every current kind has a
// non-empty path and that shell is the stroked prompt.
const AGENT_KINDS: AgentKind[] = ["claude-code", "codex", "opencode", "grok"];

describe("pipGlyph / agentGlyph — identity marks", () => {
  for (const kind of AGENT_KINDS) {
    it(`${kind} is a filled brand mark with a path`, () => {
      const g = agentGlyph(kind);
      expect(g.paint).toBe("fill");
      expect(g.paths.length).toBeGreaterThan(0);
      expect(g.paths[0]!.length).toBeGreaterThan(10);
      expect(pipGlyph(kind)).toBe(g);
    });
  }

  it("shell is the stroked chevron+cursor prompt", () => {
    const g = pipGlyph("shell");
    expect(g.paint).toBe("stroke");
    expect(g.paths).toHaveLength(2);
    expect(g.strokeWidth).toBe(2.8);
  });

  it("GLYPH_SVG_CLASS is the 14px mark inside the 18px pip box", () => {
    expect(GLYPH_SVG_CLASS.split(/\s+/)).toEqual(
      expect.arrayContaining(["w-[14px]", "h-[14px]"]),
    );
  });
});

// The two OUTER axes the merged indicator folds around the core (R-activity-
// merge): the green live RING (a static glow halo) and the unread ALERT (a small
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

  // The SINGLE styling source for the amber "needs you / unread" cue, shared by
  // the host-tab awaiting-count pill and the Dock's unread badge (composed with
  // ALERT_BADGE_CLASS) so the two can't drift in colour or shape. Pin the
  // identity tokens — the amber fill, the pill rounding, and tabular numerals —
  // so a colour swap (e.g. back to the mismatched `--color-attention`) or a shape
  // change is caught here rather than only by eye across two surfaces.
  it("ATTENTION_PILL_CLASS carries the shared amber-pill identity (fill + shape + numerals)", () => {
    const cls = ATTENTION_PILL_CLASS.split(/\s+/);
    expect(cls).toContain("bg-amber-500/90"); // the chip's amber, now the shared truth
    expect(cls).toContain("rounded-full"); // the pill shape
    expect(cls).toContain("tabular-nums"); // steady-width count numerals
    expect(cls).toContain("text-black/80");
  });
});
