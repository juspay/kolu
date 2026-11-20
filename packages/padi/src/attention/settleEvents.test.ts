import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { createFinishQuiet } from "../activity/finishQuiet.ts";
import {
  frame,
  makeAgent,
  settled,
  silentLogger,
  anchored as terminals,
} from "./attentionFixture.testlib.ts";
import { createEdgeMemory } from "./edgeMemory.ts";
import { createEventSeq } from "./eventSeq.ts";
import { createFleetGate } from "./fleetGate.ts";
import { createSettleEvents, type SettleEvent } from "./settleEvents.ts";

const EMPTY: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
  settled: true,
};

const urgency = (u: Partial<PadiUrgency>): PadiUrgency => ({ ...EMPTY, ...u });

function collector() {
  const events: SettleEvent[] = [];
  const frames: Array<readonly SettleEvent[]> = [];
  let clock = 1_000;
  const edges = createEdgeMemory();
  const source = createSettleEvents({
    log: silentLogger,
    now: () => (clock += 1),
    seq: createEventSeq(),
    edges,
  });
  source.onFrame((batch) => {
    frames.push(batch);
    events.push(...batch);
  });
  return {
    events,
    frames,
    source: {
      ...source,
      observe: (
        urgency: PadiUrgency,
        terminals: ReadonlyMap<TerminalId, PadiTerminal>,
      ) => {
        edges.observe(terminals);
        source.observe(urgency, terminals);
      },
    },
  };
}

describe("createSettleEvents", () => {
  it("does not deliver on the DERIVATION's stack — a sink runs after the fold returns", async () => {
    const { events, source } = collector();
    source.observe(urgency({}), terminals());
    source.observe(
      urgency({ finishedIds: ["w"] as TerminalId[] }),
      terminals({ w: { agent: makeAgent("waiting") } }),
    );
    expect(events).toEqual([]);
    await settled();
    expect(events).toHaveLength(1);
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
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("hands a sink ONE batch per observed frame, stamped with ONE arrival time", async () => {
    const { frames, source } = collector();
    source.observe(urgency({}), terminals({ a: { agent: null } }));
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
    source.observe(urgency({}), terminals());
    await settled();
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("gone");
    expect(events[0]?.parentId).toBe("coordinator");
    expect(events[0]?.intent).toBe("fix the flaky test");
  });

  it("a departure reports the CURRENT edge, not the one from the terminal's birth", async () => {
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
    const { source } = collector();
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

describe("createSettleEvents — a redeploy", () => {
  it("tells no supervisor about a survivor that was already idle", async () => {
    const { events, source } = collector();
    const gate = createFleetGate();
    const finish = createFinishQuiet({
      log: silentLogger,
      idleAfterMs: 100,
      standingSub: false,
    });
    const fold = (fleet: ReadonlyMap<TerminalId, PadiTerminal>): void => {
      if (gate.admit(fleet)) source.observe(finish.project(fleet), fleet);
    };
    try {
      fold(frame());
      gate.awaitFirstRead("w" as TerminalId);
      fold(frame({ w: { agent: null } }));
      const read = frame({ w: { agent: makeAgent("waiting") } });
      fold(read);
      gate.firstRead("w" as TerminalId);
      fold(read);
      fold(read);
      await settled();
      expect(events).toEqual([]);
    } finally {
      finish.dispose();
      gate.dispose();
    }
  });
});
