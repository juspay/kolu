import type {
  AgentInfo,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { rankDockRows } from "./dockRowRanking";

function makeAgent(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    contextTokens: null,
  };
}

function makeMeta(overrides: Partial<TerminalMetadata> = {}): TerminalMetadata {
  return {
    cwd: "/tmp",
    git: null,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

describe("rankDockRows — parked bucket precedence", () => {
  // The activity-window selector exists to compress yesterday's queue
  // out of the prominent buckets. A waiting agent past the threshold
  // MUST route to `parked` — not stay in `awaiting` — or the selector
  // has no effect on the wall-of-cards problem it solves. Identity is
  // preserved at the render layer (QuietRowBody paints AgentIndicator
  // when meta.agent is set), not by keeping the row in `awaiting`.
  it("parks a stale waiting agent regardless of attention state", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: 1,
    });
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      // Pretend the activity-window predicate fires for this terminal.
      () => true,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bucket).toBe("parked");
  });

  it("parks a stale awaiting_user agent the same way", () => {
    const meta = makeMeta({
      agent: makeAgent("awaiting_user"),
      lastActivityAt: 1,
    });
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => true,
    );
    expect(rows[0]?.bucket).toBe("parked");
  });

  it("keeps a fresh waiting agent in awaiting", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: Date.now(),
    });
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      // Activity window says fresh.
      () => false,
    );
    expect(rows[0]?.bucket).toBe("awaiting");
  });

  it("keeps a fresh working agent in working, parks it when stale", () => {
    const meta = makeMeta({
      agent: makeAgent("tool_use"),
      lastActivityAt: 1,
    });
    const fresh = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => false,
    );
    expect(fresh[0]?.bucket).toBe("working");
    const stale = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => true,
    );
    expect(stale[0]?.bucket).toBe("parked");
  });

  it("never-touched plain shells route to none, not idle", () => {
    const meta = makeMeta({ agent: null, lastActivityAt: 0 });
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => false,
    );
    expect(rows[0]?.bucket).toBe("none");
  });

  it("agent metadata survives the move to parked — render layer can paint identity", () => {
    // A stale waiting agent lands in `parked`, but its `meta.agent`
    // stays populated so QuietRowBody / MobileDockDrawer can paint the
    // AgentIndicator on the compact row. Without this guarantee the
    // sleep-overnight bug returns: the row reads as a plain shell.
    const meta = makeMeta({
      agent: makeAgent("waiting"),
      lastActivityAt: 1,
    });
    const rows = rankDockRows(
      ["t1"] as TerminalId[],
      () => meta,
      () => true,
    );
    // rankDockRows returns RankedDockRow which carries id + bucket + ts;
    // the consumer reads meta via getMeta directly. This test asserts
    // the contract: the SAME meta the ranker saw is what consumers will
    // read for rendering.
    expect(rows[0]?.bucket).toBe("parked");
    expect(meta.agent?.state).toBe("waiting");
  });
});
