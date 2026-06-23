import {
  type ActiveTerminal,
  type AgentInfo,
  agentUrgency,
  LOCAL_LOCATION,
  type TerminalId,
  type TerminalMetadata,
  type Urgency,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { paintBucket } from "../dockModel";
import { type DockRowBucket, rankDockRows } from "./dockRowRanking";

function makeAgent(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/tmp",
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

function makeSleepingMeta(lastActivityAt = 0): TerminalMetadata {
  return {
    state: "sleeping",
    sleptAt: 1_700_000_000_000,
    cwd: "/tmp",
    git: null,
    location: LOCAL_LOCATION,
    lastActivityAt,
  };
}

/** Convenience: rank a single terminal and return its ORDER bucket. */
function bucket(meta: TerminalMetadata, stale: boolean): DockRowBucket {
  return rankOne(meta, stale).bucket;
}

/** Convenience: rank a single terminal and return its PIP bucket (the colour
 *  the row's `StatePip` paints, decoupled from order). */
function pip(meta: TerminalMetadata, stale: boolean): DockRowBucket {
  return rankOne(meta, stale).pip;
}

function rankOne(meta: TerminalMetadata, stale: boolean) {
  const rows = rankDockRows(
    ["t1"] as TerminalId[],
    () => meta,
    () => stale,
  );
  const row = rows[0];
  if (!row) throw new Error("no row returned");
  return row;
}

describe("rankDockRows — parked bucket precedence", () => {
  // The activity-window selector exists to compress yesterday's queue
  // out of the prominent buckets. A waiting agent past the threshold
  // MUST route to `parked` — not stay in `awaiting` — or the selector
  // has no effect on the wall-of-cards problem it solves. Identity is
  // preserved at the render layer (QuietRowBody paints AgentIndicator
  // when meta.agent is set), not by keeping the row in `awaiting`.
  it("parks a stale waiting agent regardless of attention state", () => {
    const meta = makeMeta({ agent: makeAgent("waiting"), lastActivityAt: 1 });
    expect(bucket(meta, true)).toBe("parked");
  });

  it("parks a stale awaiting_user agent the same way", () => {
    const meta = makeMeta({
      agent: makeAgent("awaiting_user"),
      lastActivityAt: 1,
    });
    expect(bucket(meta, true)).toBe("parked");
  });

  it("ranks a fresh waiting agent as idle — the post-turn lull is not needs-you", () => {
    // `waiting` is the post-turn lull (Claude's end_turn / an interrupt): the
    // agent finished its turn and yielded, it is NOT blocked on you. The dock
    // ranks it idle, matching `agentProjection.agentUrgency` (and pulam-web) —
    // contrast `awaiting_user` below, which floats to the awaiting row. The
    // render layer still paints the AgentIndicator from `meta.agent`, so the
    // quieter bucket doesn't erase the agent's identity.
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: Date.now(),
    });
    expect(bucket(meta, false)).toBe("idle");
  });

  it("keeps a fresh awaiting_user agent in awaiting — it IS blocked on you", () => {
    const meta = makeMeta({
      agent: makeAgent("awaiting_user"),
      lastActivityAt: Date.now(),
    });
    expect(bucket(meta, false)).toBe("awaiting");
  });

  it("keeps a fresh working agent in working, parks it when stale", () => {
    const meta = makeMeta({ agent: makeAgent("tool_use"), lastActivityAt: 1 });
    expect(bucket(meta, false)).toBe("working");
    expect(bucket(meta, true)).toBe("parked");
  });

  it("never-touched plain shells route to none, not idle", () => {
    expect(bucket(makeMeta(), false)).toBe("none");
  });

  it("classifies a sleeping terminal as its own bucket, not none", () => {
    expect(bucket(makeSleepingMeta(), false)).toBe("sleeping");
  });

  it("keeps a sleeping terminal in sleeping even when STALE — decoupled from parked", () => {
    // A long-slept tile must read 'asleep', never be parked-dropped; the dock's
    // sleeping check runs before the parked check precisely for this.
    expect(bucket(makeSleepingMeta(1), true)).toBe("sleeping");
  });

  it("never drops a sleeping row from the ranking", () => {
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => makeSleepingMeta(1),
      () => true,
    );
    expect(rows.map((r) => r.id)).toContain("t1");
  });

  it("meta.agent is not mutated by ranking — render layer retains identity after park", () => {
    // rankDockRows must not clear or replace meta.agent when it routes a
    // terminal to `parked`. QuietRowBody reads meta.agent directly to paint
    // the AgentIndicator on the compact row; if ranking cleared it, the
    // sleep-overnight bug returns (row reads as a plain shell).
    const meta = makeMeta({ agent: makeAgent("waiting"), lastActivityAt: 1 });
    const agentBefore = meta.agent;
    rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => true,
    );
    expect(meta.agent).toBe(agentBefore); // identity preserved — same object reference
    expect(meta.agent?.state).toBe("waiting");
  });
});

describe("row ORDER vs row COLOUR are decoupled — the pip matches the tile title", () => {
  // The dock row and the tile title both render through `StatePip`, so a given
  // state must paint the SAME pip colour in both. Order (rank) is a separate
  // axis: a fresh `waiting` agent sorts as `idle` (it doesn't float into the
  // needs-you order) yet keeps its `awaiting` glow, exactly as the title does.
  it("a fresh waiting agent ranks idle but its pip stays awaiting (glow lingers)", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: Date.now(),
    });
    expect(bucket(meta, false)).toBe("idle"); // ORDER: not needs-you
    expect(pip(meta, false)).toBe("awaiting"); // COLOUR: still glowing
  });

  it("the row pip equals the tile-title paint fold for every fresh agent state", () => {
    const STATES: AgentInfo["state"][] = [
      "thinking",
      "tool_use",
      "running_background",
      "awaiting_user",
      "waiting",
    ];
    for (const state of STATES) {
      const meta = makeMeta({
        agent: makeAgent(state),
        lastActivityAt: Date.now(),
      });
      // `paintBucket` is the fold `TerminalMeta` feeds its title pip — the dock
      // row pip must agree so one state never shows two colours.
      expect(pip(meta, false)).toBe(paintBucket(makeAgent(state)));
    }
  });

  it("a sleeping row keeps its ☾ pip; a never-touched shell keeps none", () => {
    expect(pip(makeSleepingMeta(), false)).toBe("sleeping");
    expect(pip(makeMeta(), false)).toBe("none");
  });
});

describe("dock ⇄ agentProjection urgency parity (the cross-consumer differential)", () => {
  // The #1535 review flagged that nothing pinned "the dock ranks an agent state
  // the SAME way pulam-tui / pulam-web do". This asserts it structurally: for
  // every agent state, the dock's row bucket maps back to the same urgency the
  // shared `agentProjection.agentUrgency` yields. If the dock ever re-grows a
  // hand-rolled bucket that disagrees (the historical `waiting`→awaiting drift),
  // this test goes red — making "consistent with pulam-web" a fact, not prose.
  const ROW_BUCKET_URGENCY: Partial<Record<DockRowBucket, Urgency>> = {
    awaiting: "need",
    working: "work",
    idle: "idle",
  };

  const STATES: AgentInfo["state"][] = [
    "thinking",
    "tool_use",
    "running_background",
    "awaiting_user",
    "waiting",
  ];

  for (const state of STATES) {
    it(`ranks a fresh ${state} agent at agentProjection's urgency`, () => {
      // lastActivityAt > 0 so an idle-urgency agent lands in `idle`, not the
      // never-touched `none` tail (which carries no agent and no urgency).
      const meta = makeMeta({ agent: makeAgent(state), lastActivityAt: 1 });
      expect(ROW_BUCKET_URGENCY[bucket(meta, false)]).toBe(
        agentUrgency(makeAgent(state)),
      );
    });
  }
});
