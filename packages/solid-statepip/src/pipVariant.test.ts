import {
  type AgentPaintClass,
  agentPaintClass,
} from "@kolu/terminal-vocab/agentProjection";
import type { AgentKind } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  ALERT_BADGE_CLASS,
  AWAITING_PILL_CLASS,
  DOCK_ROW_PIP_BOX,
  GLYPH_SVG_CLASS,
  INDICATOR_BASE,
  NEEDS_YOU_PILL_CLASS,
  PIP_BODY,
  PIP_MOTION_CLASS,
  PIP_TITLES,
  type PipVariant,
  SHELL_LIVE_CLASS,
  TITLE_PIP_BOX,
  UNREAD_PILL_CLASS,
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
  ["working", ["text-busy"]],
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
    expect(PIP_MOTION_CLASS.none).toBeNull();
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

  it("SHELL_LIVE_CLASS is busy orange — one shell tier when live", () => {
    expect(SHELL_LIVE_CLASS).toBe("text-busy");
  });
});

describe("PIP_MOTION_CLASS — activity channel tokens", () => {
  it("spin / glow / none kinds carry the right class tokens", () => {
    expect(PIP_MOTION_CLASS.spin).toContain("statepip-anim-spin");
    expect(PIP_MOTION_CLASS.spin).toContain("motion-reduce:animate-none");
    expect(PIP_MOTION_CLASS.glow).toContain("statepip-anim-glow");
    expect(PIP_MOTION_CLASS.glow).toContain("statepip-awaiting-core");
    expect(PIP_MOTION_CLASS.glow).toContain("motion-reduce:animate-none");
    expect(PIP_MOTION_CLASS.none).toBeNull();
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

  it("GLYPH_SVG_CLASS is the 16px mark inside the 20px dock pip box", () => {
    expect(GLYPH_SVG_CLASS.split(/\s+/)).toEqual(
      expect.arrayContaining(["w-[16px]", "h-[16px]"]),
    );
  });
});

// Outer-axis overlays: unread ALERT badge (amber corner dot). Live plate was
// retired (no disc behind the glyph). Class name kept for CSS contract tests.
describe("the indicator wrapper + outer-axis overlays", () => {
  it("the leaf wrapper is a content-sized relative box (anchors the absolute overlays), no surface geometry", () => {
    const cls = INDICATOR_BASE.split(/\s+/);
    expect(cls).toContain("relative"); // positioning context for the overlays
    expect(cls).toContain("flex-none"); // never stretch/shrink beside flexed siblings
    // The leaf owns NO fixed box — a surface that reserves a column passes the
    // box in via `DOCK_ROW_PIP_BOX`, so an inline caller sizes to its own text.
    expect(cls).not.toContain("w-[20px]");
    expect(cls).not.toContain("border-2"); // no border — overlays carry the rings
  });

  it("DOCK_ROW_PIP_BOX is the caller-supplied 20px column box, not baked into the leaf", () => {
    const cls = DOCK_ROW_PIP_BOX.split(/\s+/);
    expect(cls).toContain("w-[20px]");
    expect(cls).toContain("h-[20px]");
    expect(cls).toContain("rounded-full");
  });

  it("TITLE_PIP_BOX is the smaller caller-supplied 16px box the tile title reserves so the alert badge anchors to a corner, not onto the core", () => {
    const cls = TITLE_PIP_BOX.split(/\s+/);
    expect(cls).toContain("w-[16px]");
    expect(cls).toContain("h-[16px]");
    expect(cls).toContain("rounded-full");
  });

  it("the alert badge is the shared statepip.css class (corner amber dot)", () => {
    expect(ALERT_BADGE_CLASS).toBe("statepip-alert-badge");
  });

  // Two host/chrome pills, deliberately different hues:
  //   needs-you (violet) ≠ unread (amber). Never collapse them.
  it("NEEDS_YOU_PILL_CLASS is violet (awaiting) — not amber unread", () => {
    const cls = NEEDS_YOU_PILL_CLASS.split(/\s+/);
    expect(cls).toContain("bg-alert/90");
    expect(cls).toContain("rounded-full");
    expect(cls).toContain("tabular-nums");
    expect(AWAITING_PILL_CLASS).toBe(NEEDS_YOU_PILL_CLASS);
  });

  it("UNREAD_PILL_CLASS is amber attention — not violet needs-you", () => {
    const cls = UNREAD_PILL_CLASS.split(/\s+/);
    expect(cls).toContain("bg-attention/90");
    expect(cls).toContain("rounded-full");
    expect(UNREAD_PILL_CLASS).not.toBe(NEEDS_YOU_PILL_CLASS);
  });
});
