/**
 * The ONE test for the renderer-agnostic agent-state projection — the bucketing,
 * urgency fold, recency format, short name, idle-label fork, and needs-you-first
 * ordering both pulam-tui and pulam-web import. Replaces the hand-mirrored copies
 * that used to live in BOTH `render.test.ts` and `fleet.test.ts`; those now keep
 * only their renderer-specific bits.
 */

import { describe, expect, it } from "vitest";
import {
  agentBucket,
  agentPaintClass,
  agentShortName,
  agentStatusLabel,
  agentUrgency,
  alertClass,
  compareAgents,
  DASH,
  fleetStateLabel,
  relativeTime,
  URGENCY_RANK,
  type Urgency,
} from "./agentProjection.ts";
import type { AgentInfo, Observation } from "./schema.ts";

/** A minimal agent for the projection (it reads only `kind`/`state`). */
const agentVal = (
  state: AgentInfo["state"],
  kind = "claude-code",
): Observation["agent"] => ({ kind, state }) as Observation["agent"];

describe("agentBucket", () => {
  it("maps the working states", () => {
    expect(agentBucket("thinking")).toBe("working");
    expect(agentBucket("tool_use")).toBe("working");
    expect(agentBucket("running_background")).toBe("working");
  });
  it("maps awaiting and waiting", () => {
    expect(agentBucket("awaiting_user")).toBe("awaiting");
    expect(agentBucket("waiting")).toBe("waiting");
  });
  it("surfaces an unknown state verbatim as `other` (fail-loud, not miscoloured)", () => {
    expect(agentBucket("brand_new_state" as AgentInfo["state"])).toBe("other");
  });
});

describe("agentStatusLabel", () => {
  it("buckets working / awaiting / waiting", () => {
    expect(agentStatusLabel("thinking")).toBe("working");
    expect(agentStatusLabel("tool_use")).toBe("working");
    expect(agentStatusLabel("running_background")).toBe("working");
    expect(agentStatusLabel("awaiting_user")).toBe("awaiting");
    expect(agentStatusLabel("waiting")).toBe("waiting");
  });
  it("falls through unknown states verbatim", () => {
    expect(agentStatusLabel("brand_new_state" as AgentInfo["state"])).toBe(
      "brand_new_state",
    );
  });
});

describe("agentPaintClass", () => {
  it("paints the working states", () => {
    expect(agentPaintClass("thinking")).toBe("working");
    expect(agentPaintClass("tool_use")).toBe("working");
    expect(agentPaintClass("running_background")).toBe("working");
  });
  it("paints awaiting_user AND waiting as awaiting — the glow lingers past the turn", () => {
    expect(agentPaintClass("awaiting_user")).toBe("awaiting");
    expect(agentPaintClass("waiting")).toBe("awaiting");
  });
  it("paints an unknown state as none (no glow)", () => {
    expect(agentPaintClass("brand_new_state" as AgentInfo["state"])).toBe(
      "none",
    );
  });
});

describe("alertClass", () => {
  it("notifies on the two attention states", () => {
    expect(alertClass("awaiting_user")).toBe("notify");
    expect(alertClass("waiting")).toBe("notify");
  });
  it("stays quiet on working states and unknowns", () => {
    expect(alertClass("thinking")).toBe("quiet");
    expect(alertClass("tool_use")).toBe("quiet");
    expect(alertClass("running_background")).toBe("quiet");
    expect(alertClass("brand_new_state" as AgentInfo["state"])).toBe("quiet");
  });
});

describe("agentUrgency", () => {
  it("buckets awaiting → need, working → work, the rest → idle", () => {
    expect(agentUrgency(agentVal("awaiting_user"))).toBe("need");
    expect(agentUrgency(agentVal("thinking"))).toBe("work");
    expect(agentUrgency(agentVal("tool_use"))).toBe("work");
    expect(agentUrgency(agentVal("running_background"))).toBe("work");
    expect(agentUrgency(agentVal("waiting"))).toBe("idle");
    expect(agentUrgency(agentVal("brand_new" as AgentInfo["state"]))).toBe(
      "idle",
    );
    expect(agentUrgency(null)).toBe("idle");
  });
});

describe("agentShortName", () => {
  it("shortens claude-code, passes others through", () => {
    expect(agentShortName("claude-code")).toBe("claude");
    expect(agentShortName("codex")).toBe("codex");
    expect(agentShortName("opencode")).toBe("opencode");
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000_000;
  it("0 / never → em-dash", () => {
    expect(relativeTime(0, now)).toBe(DASH);
  });
  it("formats seconds / minutes / hours / days", () => {
    expect(relativeTime(now - 5_000, now)).toBe("5s");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d");
  });
});

describe("fleetStateLabel (idle three-way fork, renderer labels passed in)", () => {
  // Two label sets — the TUI's ("awaiting you") and the web's ("needs you") —
  // so the test pins that the ONLY renderer difference is the label words.
  const tui: Record<Urgency, string> = {
    need: "awaiting you",
    work: "working",
    idle: "idle",
  };
  const web: Record<Urgency, string> = {
    need: "needs you",
    work: "working",
    idle: "idle",
  };
  it("need / work read the renderer's urgency label", () => {
    expect(fleetStateLabel(agentVal("awaiting_user"), tui)).toBe(
      "awaiting you",
    );
    expect(fleetStateLabel(agentVal("awaiting_user"), web)).toBe("needs you");
    expect(fleetStateLabel(agentVal("thinking"), web)).toBe("working");
  });
  it("an idle agent shows its own state; an unknown state shows verbatim", () => {
    expect(fleetStateLabel(agentVal("waiting"), web)).toBe("waiting");
    expect(
      fleetStateLabel(agentVal("brand_new_state" as AgentInfo["state"]), web),
    ).toBe("brand_new_state");
  });
  it("no agent reads the idle label", () => {
    expect(fleetStateLabel(null, web)).toBe("idle");
  });
});

describe("URGENCY_RANK", () => {
  it("ranks need < work < idle", () => {
    expect(URGENCY_RANK.need).toBeLessThan(URGENCY_RANK.work);
    expect(URGENCY_RANK.work).toBeLessThan(URGENCY_RANK.idle);
  });
});

describe("compareAgents (needs-you-first)", () => {
  const e = (id: string, state: AgentInfo["state"] | null, at: number) => ({
    id,
    lastActivityAt: at,
    agent: state === null ? null : agentVal(state),
  });

  it("a blocked agent floats above a MORE-RECENT working agent (urgency beats recency)", () => {
    const need = e("1", "awaiting_user", 1_000); // older
    const work = e("2", "thinking", 9_999); // newer
    expect([work, need].sort(compareAgents).map((x) => x.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("within equal urgency, the most-recently-active sorts first", () => {
    const stale = e("1", "thinking", 1_000);
    const fresh = e("2", "thinking", 9_000);
    expect([stale, fresh].sort(compareAgents).map((x) => x.id)).toEqual([
      "2",
      "1",
    ]);
  });

  it("ties on urgency + recency break by id", () => {
    const a = e("a", "thinking", 5_000);
    const b = e("b", "thinking", 5_000);
    expect([b, a].sort(compareAgents).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("orders a full mix need < work < idle", () => {
    const need = e("3", "awaiting_user", 100);
    const work = e("2", "thinking", 100);
    const idle = e("1", "waiting", 100);
    expect(
      [idle, work, need].sort(compareAgents).map((x) => agentUrgency(x.agent)),
    ).toEqual(["need", "work", "idle"]);
  });
});
