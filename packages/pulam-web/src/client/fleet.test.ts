/**
 * Pins `fleet.ts` — the projection ported from pulam-tui — to the TUI's
 * behaviour, so the two copies can't drift. Pure functions, no DOM: bucketing,
 * the needs-you-first ordering, recency formatting, terminal categorisation, and
 * the filter predicate. Mirrors the assertions in pulam-tui's `render.test.ts`.
 */

import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import { seedAwarenessValue } from "@kolu/terminal-workspace";
import { describe, expect, it } from "vitest";
import {
  agentBucket,
  agentShortName,
  agentUrgency,
  basename,
  compareFleetEntries,
  type FleetEntry,
  isVisible,
  locationText,
  relativeTime,
  stateLabel,
  terminalCategory,
  URGENCY,
} from "./fleet.ts";

/** Build an awareness value with a given agent state. Only `kind`/`state` are
 *  read by the projection, so a minimal cast keeps the test on the projection
 *  rather than reconstructing every agent field. */
function withAgent(
  state: string,
  opts: { kind?: string; lastActivityAt?: number; cwd?: string } = {},
): AwarenessValue {
  return {
    ...seedAwarenessValue(opts.cwd ?? "/work/repo"),
    lastActivityAt: opts.lastActivityAt ?? 0,
    agent: {
      kind: opts.kind ?? "claude-code",
      state,
    } as AwarenessValue["agent"],
  };
}

const id = (n: number): TerminalId =>
  `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111` as TerminalId;

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
    expect(agentBucket("brand_new_state")).toBe("other");
  });
});

describe("agentUrgency", () => {
  it("no agent → idle", () => {
    expect(agentUrgency(null)).toBe("idle");
  });
  it("awaiting_user → need", () => {
    expect(agentUrgency(withAgent("awaiting_user").agent)).toBe("need");
  });
  it("working states → work", () => {
    expect(agentUrgency(withAgent("thinking").agent)).toBe("work");
    expect(agentUrgency(withAgent("tool_use").agent)).toBe("work");
    expect(agentUrgency(withAgent("running_background").agent)).toBe("work");
  });
  it("waiting / unknown → idle", () => {
    expect(agentUrgency(withAgent("waiting").agent)).toBe("idle");
    expect(agentUrgency(withAgent("brand_new_state").agent)).toBe("idle");
  });
});

describe("stateLabel", () => {
  it("need / work read the urgency label", () => {
    expect(stateLabel(withAgent("awaiting_user").agent)).toBe("needs you");
    expect(stateLabel(withAgent("thinking").agent)).toBe("working");
  });
  it("an idle agent shows its own state; an unknown state shows verbatim", () => {
    expect(stateLabel(withAgent("waiting").agent)).toBe("waiting");
    expect(stateLabel(withAgent("brand_new_state").agent)).toBe(
      "brand_new_state",
    );
  });
  it("no agent reads idle", () => {
    expect(stateLabel(null)).toBe("idle");
  });
});

describe("agentShortName", () => {
  it("shortens claude-code, passes others through", () => {
    expect(agentShortName("claude-code")).toBe("claude");
    expect(agentShortName("codex")).toBe("codex");
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000_000;
  it("0 / never → em-dash", () => {
    expect(relativeTime(0, now)).toBe("—");
  });
  it("formats seconds / minutes / hours / days", () => {
    expect(relativeTime(now - 5_000, now)).toBe("5s");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d");
  });
});

describe("compareFleetEntries (needs-you-first)", () => {
  const entry = (
    i: number,
    state: string | null,
    lastActivityAt: number,
  ): FleetEntry => ({
    id: id(i),
    value:
      state === null
        ? { ...seedAwarenessValue("/x"), lastActivityAt }
        : withAgent(state, { lastActivityAt }),
  });

  it("a blocked agent floats above a MORE-RECENT working agent (urgency beats recency)", () => {
    const need = entry(1, "awaiting_user", 1_000); // older
    const work = entry(2, "thinking", 9_999); // newer
    expect([work, need].sort(compareFleetEntries).map((e) => e.id)).toEqual([
      need.id,
      work.id,
    ]);
  });

  it("within equal urgency, the most-recently-active sorts first", () => {
    const stale = entry(1, "thinking", 1_000);
    const fresh = entry(2, "thinking", 9_000);
    expect([stale, fresh].sort(compareFleetEntries).map((e) => e.id)).toEqual([
      fresh.id,
      stale.id,
    ]);
  });

  it("ties on urgency + recency break by id", () => {
    const a = entry(1, "thinking", 5_000);
    const b = entry(2, "thinking", 5_000);
    expect([b, a].sort(compareFleetEntries).map((e) => e.id)).toEqual([
      a.id,
      b.id,
    ]);
  });

  it("orders a full mix need < work < idle", () => {
    const need = entry(3, "awaiting_user", 100);
    const work = entry(2, "thinking", 100);
    const idle = entry(1, "waiting", 100);
    expect(
      [idle, work, need]
        .sort(compareFleetEntries)
        .map((e) => agentUrgency(e.value.agent)),
    ).toEqual(["need", "work", "idle"]);
  });
});

describe("terminalCategory", () => {
  it("an active agent (need/work) → active", () => {
    expect(terminalCategory(withAgent("awaiting_user"))).toBe("active");
    expect(terminalCategory(withAgent("thinking"))).toBe("active");
  });
  it("an idle/waiting agent → idle", () => {
    expect(terminalCategory(withAgent("waiting"))).toBe("idle");
  });
  it("no agent but a foreground process → nonagent", () => {
    const v: AwarenessValue = {
      ...seedAwarenessValue("/x"),
      foreground: { name: "vim", title: null },
    };
    expect(terminalCategory(v)).toBe("nonagent");
  });
  it("no agent and no foreground → sleeping", () => {
    expect(terminalCategory(seedAwarenessValue("/x"))).toBe("sleeping");
  });
});

describe("isVisible", () => {
  const allOff = { idle: false, nonagent: false, sleeping: false };
  it("active agents are always visible", () => {
    expect(isVisible("active", allOff)).toBe(true);
  });
  it("idle / nonagent / sleeping are gated by their toggle", () => {
    expect(isVisible("idle", allOff)).toBe(false);
    expect(isVisible("idle", { ...allOff, idle: true })).toBe(true);
    expect(isVisible("nonagent", allOff)).toBe(false);
    expect(isVisible("nonagent", { ...allOff, nonagent: true })).toBe(true);
    expect(isVisible("sleeping", allOff)).toBe(false);
    expect(isVisible("sleeping", { ...allOff, sleeping: true })).toBe(true);
  });
});

describe("locationText", () => {
  it("repo · branch when in a repo", () => {
    const v: AwarenessValue = {
      ...seedAwarenessValue("/work/kolu"),
      git: {
        repoName: "kolu",
        branch: "feat/dial-ssh",
      } as AwarenessValue["git"],
    };
    expect(locationText(v)).toBe("kolu · feat/dial-ssh");
  });
  it("cwd basename when not in a repo", () => {
    expect(locationText(seedAwarenessValue("/work/repo-a"))).toBe("repo-a");
  });
});

describe("basename", () => {
  it("trims a trailing slash and takes the last segment", () => {
    expect(basename("/a/b/")).toBe("b");
    expect(basename("/a/b")).toBe("b");
    expect(basename("solo")).toBe("solo");
  });
});

describe("URGENCY table", () => {
  it("ranks need < work < idle", () => {
    expect(URGENCY.need.rank).toBeLessThan(URGENCY.work.rank);
    expect(URGENCY.work.rank).toBeLessThan(URGENCY.idle.rank);
  });
});
