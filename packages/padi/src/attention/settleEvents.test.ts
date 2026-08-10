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

/** A terminals map for the given ids.
 *
 *  Every map carries a constant `anchor` terminal that is never asked about, for
 *  two reasons: a genuinely EMPTY map is the serve-time pre-adopt frame, which
 *  `observe` deliberately refuses to take as its baseline; and an id that
 *  vanishes between two frames is a DEPARTURE, so a helper that dropped its own
 *  scaffolding between calls would manufacture `gone` events. Use
 *  {@link emptyTerminals} to exercise the pre-adopt frame on purpose. */
function terminals(
  overrides: Record<string, Parameters<typeof activeTerminal>[0]> = {},
): ReadonlyMap<TerminalId, PadiTerminal> {
  const map = new Map<TerminalId, PadiTerminal>();
  map.set("anchor" as TerminalId, activeTerminal({ agent: null }));
  for (const [id, opts] of Object.entries(overrides)) {
    map.set(id as TerminalId, activeTerminal(opts));
  }
  return map;
}

/** The serve-time frame: padi's registry before the endpoint adopted kaval. */
const emptyTerminals = (): ReadonlyMap<TerminalId, PadiTerminal> => new Map();

/** Drive a source and collect what it emitted. */
function collector() {
  const events: SettleEvent[] = [];
  let clock = 1_000;
  const source = createSettleEvents(() => (clock += 1));
  source.onEvent((e) => events.push(e));
  return { events, source };
}

describe("createSettleEvents", () => {
  it("the SERVE-TIME empty frame does not spend the baseline — the first REAL inventory is still a discovery", () => {
    const { events, source } = collector();
    // padi's `urgency` derivation runs once before the endpoint has adopted
    // kaval's terminals, so its first frame is an empty registry. If that
    // information-free frame were taken as the baseline, every already-settled
    // worker would be re-announced to its supervisor on every padi restart.
    source.observe(urgency({}), emptyTerminals());
    source.observe(
      urgency({
        awaitingIds: ["a"] as TerminalId[],
        finishedIds: ["b"] as TerminalId[],
      }),
      terminals({
        a: { agent: makeAgent("awaiting_user"), parentId: "boss" },
        b: { agent: makeAgent("waiting"), parentId: "boss" },
      }),
    );
    expect(events).toEqual([]);
  });

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

  it("reports a terminal LEAVING — a supervisor must not wait forever on a worker that is gone", () => {
    const { events, source } = collector();
    const map = terminals({ w: { agent: makeAgent("thinking") } });
    source.observe(urgency({ workingIds: ["w"] as TerminalId[] }), map);
    // The worker exits (or a kaval recycle retires its id).
    source.observe(urgency({}), terminals());
    expect(events.map((e) => [e.id, e.kind])).toEqual([["w", "gone"]]);
  });

  it("the FIRST frame's inventory is a discovery — existing terminals are not reported as arriving or leaving", () => {
    const { events, source } = collector();
    source.observe(
      urgency({}),
      terminals({ a: { agent: null }, b: { agent: null } }),
    );
    expect(events).toEqual([]);
    // And only the one that actually leaves is reported.
    source.observe(urgency({}), terminals({ a: { agent: null } }));
    expect(events.map((e) => [e.id, e.kind])).toEqual([["b", "gone"]]);
  });

  it("a departure carries the LAST-KNOWN supervision edge — otherwise it could never be delivered", () => {
    const { events, source } = collector();
    source.observe(
      urgency({ workingIds: ["w"] as TerminalId[] }),
      terminals({
        w: {
          agent: makeAgent("thinking"),
          parentId: "coordinator",
          intent: "fix the flaky test",
        },
      }),
    );
    // By the time it is gone its record is gone too, so the parent is only
    // knowable from the frame that still had it.
    source.observe(urgency({}), terminals());
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("gone");
    expect(events[0]?.parentId).toBe("coordinator");
    expect(events[0]?.intent).toBe("fix the flaky test");
  });

  it("a departure fires once, not on every later frame", () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals({ w: { agent: null } }));
    source.observe(urgency({}), terminals());
    source.observe(urgency({}), terminals());
    source.observe(urgency({}), terminals());
    expect(events).toHaveLength(1);
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
