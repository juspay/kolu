/**
 * Pins the settle-event EDGE: that padi emits once per attention episode, that a
 * redundant recompute emits nothing (which is what makes observing from inside
 * the `urgency` derivation safe), that each event carries the lane attribution
 * a subscriber needs — and that no sink ever runs on the derivation's own
 * stack (every assertion below waits a microtask first, which IS the pin).
 */

import { pino } from "pino";
import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import type { PadiTerminal, PadiUrgency } from "../surface.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "../vocab.ts";
import { createEventSeq } from "./eventSeq.ts";
import { createSettleEvents, type SettleEvent } from "./settleEvents.ts";

const silentLogger = pino({ level: "silent" });

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

/** Let the queued frame flushes run. Sinks are deliberately NOT called on the
 *  `urgency` derivation's stack, so nothing has been delivered before this. */
const settled = (): Promise<void> => Promise.resolve();

/** Drive a source and collect what it emitted, both as flat events and as the
 *  FRAMES it grouped them into. */
function collector() {
  const events: SettleEvent[] = [];
  const frames: Array<readonly SettleEvent[]> = [];
  let clock = 1_000;
  const source = createSettleEvents({
    log: silentLogger,
    now: () => (clock += 1),
    seq: createEventSeq(),
  });
  source.onFrame((batch) => {
    frames.push(batch);
    events.push(...batch);
  });
  return { events, frames, source };
}

describe("createSettleEvents", () => {
  it("does not deliver on the DERIVATION's stack — a sink runs after the fold returns", async () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ finishedIds: ["w"] as TerminalId[] }),
      terminals({ w: { agent: makeAgent("waiting") } }),
    );
    // A sink here writes into another process's PTY. The reactor's DUAL EDGE
    // latitude covers a cell writing a level it read; it does not extend to
    // performing I/O on the recompute stack.
    expect(events).toEqual([]);
    await settled();
    expect(events).toHaveLength(1);
  });

  it("the SERVE-TIME empty frame does not spend the baseline — the first REAL inventory is still a discovery", async () => {
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
    await settled();
    expect(events).toEqual([]);
  });

  it("the FIRST frame is a discovery, not a transition — a workspace already full of finished agents emits nothing", async () => {
    const { events, source } = collector();
    source.observe(
      urgency({
        awaitingIds: ["a"] as TerminalId[],
        finishedIds: ["b"] as TerminalId[],
      }),
      terminals({ a: { agent: makeAgent("awaiting_user") } }),
    );
    await settled();
    expect(events).toEqual([]);
  });

  it("emits once when a terminal ENTERS asking, and again when another finishes", async () => {
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
    await settled();
    expect(events.map((e) => [e.id, e.kind])).toEqual([
      ["a", "asking"],
      ["b", "finished"],
    ]);
    // Sequence is monotonic — it is the cursor a standing subscription drains on.
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("hands a sink ONE batch per observed frame, stamped with ONE arrival time", async () => {
    const { frames, source } = collector();
    source.observe(urgency({}), terminals({ a: { agent: null } }));
    // One fold, two edges: a worker starts asking while another leaves. That is
    // one fact about the workspace, so a sink that must group (one nudge per
    // supervisor) is not made to reconstitute the grouping.
    source.observe(
      urgency({ awaitingIds: ["b"] as TerminalId[] }),
      terminals({ b: { agent: makeAgent("awaiting_user") } }),
    );
    await settled();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.map((e) => [e.id, e.kind])).toEqual([
      ["b", "asking"],
      ["a", "gone"],
    ]);
    expect(new Set(frames[0]?.map((e) => e.at)).size).toBe(1);
  });

  it("a REDUNDANT recompute emits nothing — the property that makes observing from a derivation safe", async () => {
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
    await settled();
    expect(events).toHaveLength(1);
  });

  it("carries the parent edge and the intent, so a subscriber needs no second lookup", async () => {
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
    await settled();
    expect(events).toHaveLength(1);
    expect(events[0]?.parentId).toBe("coordinator");
    expect(events[0]?.intent).toBe("fix the flaky test");
  });

  it("hands the sink the FRAME the events were computed from, so no sink re-reads the registry", async () => {
    const { source } = collector();
    const seen: Array<ReadonlyMap<TerminalId, PadiTerminal>> = [];
    source.onFrame((_events, frame) => seen.push(frame));
    source.observe(urgency({}), terminals());
    const map = terminals({
      w: { agent: makeAgent("waiting"), parentId: "coordinator" },
      coordinator: { agent: makeAgent("thinking") },
    });
    source.observe(urgency({ finishedIds: ["w"] as TerminalId[] }), map);
    await settled();
    // The supervisor's own record rides along — the delivery sink narrows it for
    // the agent guard without a second read path back into the registry.
    expect(seen[0]).toBe(map);
    expect(seen[0]?.get("coordinator" as TerminalId)).toBeDefined();
  });

  it("omits parentId for a ROOT terminal rather than spelling undefined (the optionalKey rule)", async () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ finishedIds: ["r"] as TerminalId[] }),
      terminals({ r: { agent: makeAgent("waiting") } }),
    );
    await settled();
    expect(events[0] && "parentId" in events[0]).toBe(false);
  });

  it("a worker that goes back to work and finishes AGAIN is a fresh episode", async () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    const finished = urgency({ finishedIds: ["w"] as TerminalId[] });
    const map = terminals({ w: { agent: makeAgent("waiting") } });
    source.observe(finished, map);
    source.observe(urgency({ workingIds: ["w"] as TerminalId[] }), map);
    source.observe(finished, map);
    await settled();
    expect(events).toHaveLength(2);
  });

  it("reports a terminal LEAVING — a supervisor must not wait forever on a worker that is gone", async () => {
    const { events, source } = collector();
    const map = terminals({ w: { agent: makeAgent("thinking") } });
    source.observe(urgency({ workingIds: ["w"] as TerminalId[] }), map);
    // The worker exits (or a kaval recycle retires its id).
    source.observe(urgency({}), terminals());
    await settled();
    expect(events.map((e) => [e.id, e.kind])).toEqual([["w", "gone"]]);
  });

  it("the FIRST frame's inventory is a discovery — existing terminals are not reported as arriving or leaving", async () => {
    const { events, source } = collector();
    source.observe(
      urgency({}),
      terminals({ a: { agent: null }, b: { agent: null } }),
    );
    await settled();
    expect(events).toEqual([]);
    // And only the one that actually leaves is reported.
    source.observe(urgency({}), terminals({ a: { agent: null } }));
    await settled();
    expect(events.map((e) => [e.id, e.kind])).toEqual([["b", "gone"]]);
  });

  it("a departure carries the LAST-KNOWN attribution — its record is already gone", async () => {
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
    await settled();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("gone");
    expect(events[0]?.parentId).toBe("coordinator");
    expect(events[0]?.intent).toBe("fix the flaky test");
  });

  it("a departure reports the CURRENT edge, not the one from the terminal's birth", async () => {
    // The edge memory is MAINTAINED in place rather than rebuilt per frame (it
    // runs on the ~150 ms terminals cadence), so an edge that changes mid-life
    // must still refresh — otherwise a lane renamed after it was spawned would
    // report its original intent on the way out.
    const { events, source } = collector();
    source.observe(
      urgency({}),
      terminals({ w: { agent: null, parentId: "boss", intent: "first" } }),
    );
    source.observe(
      urgency({}),
      terminals({ w: { agent: null, parentId: "boss", intent: "renamed" } }),
    );
    source.observe(urgency({}), terminals());
    await settled();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("gone");
    expect(events[0]?.intent).toBe("renamed");
  });

  it("a departure fires once, not on every later frame", async () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals({ w: { agent: null } }));
    source.observe(urgency({}), terminals());
    source.observe(urgency({}), terminals());
    source.observe(urgency({}), terminals());
    await settled();
    expect(events).toHaveLength(1);
  });

  it("a listener that throws does not starve the other listeners of the same frame", async () => {
    const source = createSettleEvents({
      log: silentLogger,
      now: () => 1,
      seq: createEventSeq(),
    });
    const seen: string[] = [];
    source.onFrame(() => {
      throw new Error("first sink is broken");
    });
    source.onFrame((batch) => seen.push(...batch.map((e) => e.id)));
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ finishedIds: ["w"] as TerminalId[] }),
      terminals({ w: { agent: makeAgent("waiting") } }),
    );
    await settled();
    expect(seen).toEqual(["w"]);
  });
});
