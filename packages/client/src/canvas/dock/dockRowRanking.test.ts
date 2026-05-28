import type {
  AgentInfo,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
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

/** Convenience: rank a single terminal and return its bucket. */
function bucket(meta: TerminalMetadata, stale: boolean): DockRowBucket {
  const rows = rankDockRows(
    ["t1"] as TerminalId[],
    () => meta,
    () => stale,
  );
  const row = rows[0];
  if (!row) throw new Error("no row returned");
  return row.bucket;
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

  it("keeps a fresh waiting agent in awaiting", () => {
    const meta = makeMeta({
      agent: makeAgent("waiting"),
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
