/**
 * Pins the settle-event EDGE: that padi emits once per attention episode, that a
 * redundant recompute emits nothing (which is what makes observing from inside
 * the `urgency` derivation safe), and that each event carries the supervision
 * edge the delivery half needs.
 */

import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import type { PadiTerminal, PadiUrgency } from "../surface.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "../vocab.ts";
import { createSettleEvents, type SettleEvent } from "./settleEvents.ts";

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

function activeTerminal(opts: {
  agent: AgentInfo | null;
  parentId?: string;
  intent?: string;
}): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent: opts.agent,
    foreground: null,
    ports: { status: "unknown" },
  };
  return composeTerminalMetadata(
    {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      ...(opts.parentId === undefined ? {} : { parentId: opts.parentId }),
      ...(opts.intent === undefined ? {} : { intent: opts.intent }),
    },
    snapshot,
  );
}

const EMPTY: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
};

const urgency = (u: Partial<PadiUrgency>): PadiUrgency => ({ ...EMPTY, ...u });

/** A terminals map where every id is an ordinary agent terminal, unless the
 *  caller overrides one. */
function terminals(
  overrides: Record<string, Parameters<typeof activeTerminal>[0]> = {},
): ReadonlyMap<TerminalId, PadiTerminal> {
  const map = new Map<TerminalId, PadiTerminal>();
  for (const [id, opts] of Object.entries(overrides)) {
    map.set(id as TerminalId, activeTerminal(opts));
  }
  return map;
}

/** Drive a source and collect what it emitted. */
function collector() {
  const events: SettleEvent[] = [];
  let clock = 1_000;
  const source = createSettleEvents(() => (clock += 1));
  source.onEvent((e) => events.push(e));
  return { events, source };
}

describe("createSettleEvents", () => {
  it("the FIRST frame is a discovery, not a transition — a workspace already full of finished agents emits nothing", () => {
    const { events, source } = collector();
    source.observe(
      urgency({
        awaitingIds: ["a"] as TerminalId[],
        finishedIds: ["b"] as TerminalId[],
      }),
      terminals({ a: { agent: makeAgent("awaiting_user") } }),
    );
    expect(events).toEqual([]);
  });

  it("emits once when a terminal ENTERS asking, and again when another finishes", () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ awaitingIds: ["a"] as TerminalId[] }),
      terminals({ a: { agent: makeAgent("awaiting_user") } }),
    );
    source.observe(
      urgency({
        awaitingIds: ["a"] as TerminalId[],
        finishedIds: ["b"] as TerminalId[],
      }),
      terminals({
        a: { agent: makeAgent("awaiting_user") },
        b: { agent: makeAgent("waiting") },
      }),
    );
    expect(events.map((e) => [e.id, e.kind])).toEqual([
      ["a", "asking"],
      ["b", "finished"],
    ]);
    // Sequence is monotonic — it is the cursor a standing subscription drains on.
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("a REDUNDANT recompute emits nothing — the property that makes observing from a derivation safe", () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    const frame = urgency({ awaitingIds: ["a"] as TerminalId[] });
    const map = terminals({ a: { agent: makeAgent("awaiting_user") } });
    source.observe(frame, map);
    // The reactor may re-run the urgency compute without a real change; three
    // more identical observations must not produce three more nudges.
    source.observe(frame, map);
    source.observe(frame, map);
    source.observe(frame, map);
    expect(events).toHaveLength(1);
  });

  it("carries the supervision edge and the intent, so delivery needs no second lookup", () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ finishedIds: ["w"] as TerminalId[] }),
      terminals({
        w: {
          agent: makeAgent("waiting"),
          parentId: "coordinator",
          intent: "fix the flaky test",
        },
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.parentId).toBe("coordinator");
    expect(events[0]?.intent).toBe("fix the flaky test");
  });

  it("omits parentId for a ROOT terminal rather than spelling undefined (the optionalKey rule)", () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ finishedIds: ["r"] as TerminalId[] }),
      terminals({ r: { agent: makeAgent("waiting") } }),
    );
    expect(events[0] && "parentId" in events[0]).toBe(false);
  });

  it("a worker that goes back to work and finishes AGAIN is a fresh episode", () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    const finished = urgency({ finishedIds: ["w"] as TerminalId[] });
    const map = terminals({ w: { agent: makeAgent("waiting") } });
    source.observe(finished, map);
    source.observe(urgency({ workingIds: ["w"] as TerminalId[] }), map);
    source.observe(finished, map);
    expect(events).toHaveLength(2);
  });

  it("a listener that throws does not starve the other listeners of the same event", () => {
    const source = createSettleEvents(() => 1);
    const seen: string[] = [];
    source.onEvent(() => {
      throw new Error("first sink is broken");
    });
    source.onEvent((e) => seen.push(e.id));
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ finishedIds: ["w"] as TerminalId[] }),
      terminals({ w: { agent: makeAgent("waiting") } }),
    );
    expect(seen).toEqual(["w"]);
  });
});
