/**
 * Pins `fleet.ts` — the pulam-web PRESENTATION layer over the shared agent-state
 * projection. The renderer-agnostic core (bucketing, urgency, recency, short
 * name, the idle-label fork, the needs-you-first ordering) is tested ONCE in
 * `@kolu/pulam-library`'s `agentProjection.test.ts`; this file keeps only
 * the web-specific bits: the location/cwd helpers, the URGENCY colour/label
 * descriptor, the web-labelled state cell, the terminal-category filter, and the
 * fleet-entry comparator adapter.
 */

import { seedAwarenessValue } from "@kolu/pulam-library";
import type { AwarenessValue, TerminalId } from "@kolu/pulam-library/surface";
import {
  agentUrgency,
  fleetStateLabel,
} from "@kolu/pulam-library/agentProjection";
import { describe, expect, it } from "vitest";
import {
  basename,
  compareFleetEntries,
  DEFAULT_FLEET_FILTERS,
  type FleetEntry,
  ACCENT_WASH,
  ALERT_WASH,
  fleetAlert,
  isVisible,
  locationText,
  pipVariantFor,
  rowBackground,
  terminalCategory,
  URGENCY,
  URGENCY_LABELS,
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

describe("fleetStateLabel with the web URGENCY_LABELS", () => {
  it("need reads the web label 'needs you'", () => {
    expect(
      fleetStateLabel(withAgent("awaiting_user").agent, URGENCY_LABELS),
    ).toBe("needs you");
    expect(fleetStateLabel(withAgent("thinking").agent, URGENCY_LABELS)).toBe(
      "working",
    );
  });
  it("an idle agent shows its own state; no agent reads idle", () => {
    expect(fleetStateLabel(withAgent("waiting").agent, URGENCY_LABELS)).toBe(
      "waiting",
    );
    expect(fleetStateLabel(null, URGENCY_LABELS)).toBe("idle");
  });
});

describe("compareFleetEntries (needs-you-first, over fleet entries)", () => {
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

describe("DEFAULT_FLEET_FILTERS (the full agent board out of the box)", () => {
  it("shows every agent by default — active AND idle, agentless hidden", () => {
    // idle ON so the board reads as a full agent board, not just "who needs me".
    expect(DEFAULT_FLEET_FILTERS.idle).toBe(true);
    expect(DEFAULT_FLEET_FILTERS.nonagent).toBe(false);
    expect(DEFAULT_FLEET_FILTERS.sleeping).toBe(false);
  });
  it("with the default, both agent categories show; the agentless ones don't", () => {
    expect(isVisible("active", DEFAULT_FLEET_FILTERS)).toBe(true);
    expect(isVisible("idle", DEFAULT_FLEET_FILTERS)).toBe(true);
    expect(isVisible("nonagent", DEFAULT_FLEET_FILTERS)).toBe(false);
    expect(isVisible("sleeping", DEFAULT_FLEET_FILTERS)).toBe(false);
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

describe("URGENCY descriptor", () => {
  it("carries the web label per urgency + a shared-theme colour token", () => {
    expect(URGENCY.need.label).toBe("needs you");
    expect(URGENCY.work.label).toBe("working");
    expect(URGENCY.idle.label).toBe("idle");
    // The colour is a shared `@kolu/theme` token now — the fleet reads the SAME
    // palette as kolu's Dock ("your turn" violet) rather than a render-local hex.
    expect(URGENCY.need.color).toBe("var(--color-alert)");
    expect(URGENCY.work.color).toBe("var(--color-accent)");
    expect(URGENCY.idle.color).toBe("var(--color-fg-3)");
  });
});

describe("pipVariantFor (the shared StatePip variant — fleet ≡ Dock)", () => {
  it("an agent folds through the shared agent-paint → pip mapping", () => {
    expect(pipVariantFor(withAgent("thinking"))).toBe("working");
    expect(pipVariantFor(withAgent("tool_use"))).toBe("working");
    expect(pipVariantFor(withAgent("awaiting_user"))).toBe("awaiting");
    // order≠colour: a just-finished `waiting` agent PAINTS `awaiting` (the
    // lingering dot) though its urgency SORTS it idle — same as kolu's Dock.
    expect(pipVariantFor(withAgent("waiting"))).toBe("awaiting");
    expect(agentUrgency(withAgent("waiting").agent)).toBe("idle");
  });

  it("no agent is the fleet's own overlay: foreground → idle, bare shell → sleeping", () => {
    const withForeground: AwarenessValue = {
      ...seedAwarenessValue("/x"),
      foreground: { name: "vim", title: null },
    };
    expect(pipVariantFor(withForeground)).toBe("idle");
    expect(pipVariantFor(seedAwarenessValue("/x"))).toBe("sleeping");
  });
});

describe("fleetAlert (the per-row badge — fleet ≡ the Dock's alert membership)", () => {
  it("the notify-class states (blocked + just-finished) raise the alert", () => {
    // Folds through the shared `alertClass`, the SAME membership kolu's
    // useTerminalAlerts fires on — so the fleet badge can't drift from the Dock.
    expect(fleetAlert(withAgent("awaiting_user"))).toBe(true);
    expect(fleetAlert(withAgent("waiting"))).toBe(true);
  });
  it("the quiet working states do not", () => {
    expect(fleetAlert(withAgent("thinking"))).toBe(false);
    expect(fleetAlert(withAgent("tool_use"))).toBe(false);
    expect(fleetAlert(withAgent("running_background"))).toBe(false);
  });
  it("a terminal with no agent has nothing to notify about", () => {
    expect(fleetAlert(seedAwarenessValue("/x"))).toBe(false);
    const withForeground: AwarenessValue = {
      ...seedAwarenessValue("/x"),
      foreground: { name: "vim", title: null },
    };
    expect(fleetAlert(withForeground)).toBe(false);
  });
});

describe("rowBackground (the per-row wash — working|live rows stand out)", () => {
  it("a working agent gets the accent (teal) wash", () => {
    expect(rowBackground(withAgent("thinking"), false)).toBe(ACCENT_WASH);
    expect(rowBackground(withAgent("tool_use"), false)).toBe(ACCENT_WASH);
    expect(rowBackground(withAgent("running_background"), false)).toBe(
      ACCENT_WASH,
    );
  });

  it("live terminal activity gets the accent wash even when the agent is idle", () => {
    // The green-ring `live` axis alone is enough — a quiet agent whose terminal
    // is moving bytes still reads as hot.
    expect(rowBackground(withAgent("waiting"), true)).toBe(ACCENT_WASH);
    expect(rowBackground(seedAwarenessValue("/x"), true)).toBe(ACCENT_WASH);
  });

  it("a needs-you agent keeps the alert (violet) wash — and it wins over work/live", () => {
    expect(rowBackground(withAgent("awaiting_user"), false)).toBe(ALERT_WASH);
    // `need` is the louder signal: a blocked agent that is ALSO live stays alert.
    expect(rowBackground(withAgent("awaiting_user"), true)).toBe(ALERT_WASH);
  });

  it("an idle, quiet row stays bare (no wash)", () => {
    expect(rowBackground(withAgent("waiting"), false)).toBeUndefined();
    expect(rowBackground(seedAwarenessValue("/x"), false)).toBeUndefined();
  });
});
