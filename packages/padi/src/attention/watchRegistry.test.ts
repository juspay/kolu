import type { PadiStateEvent } from "@kolu/padi-client/surface";
import { WatchSubscriptionNotFound } from "@kolu/padi-client/surface";
import type { WatchScope } from "@kolu/padi-client/watchScope";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  frame,
  makeAgent,
  scopeOf,
  settled,
  silentLogger,
  stateWatchHarness,
} from "./attentionFixture.testlib.ts";
import type { SettleEvent } from "./settleEvents.ts";
import type {
  StateWatchAnnounced,
  StateWatchAttachment,
  StateWatchBatch,
  StateWatchFilter,
  StateWatchSpec,
} from "./stateWatch.ts";
import { createWatchRegistry, type WatchRegistry } from "./watchRegistry.ts";
import { specOf } from "./watchSpec.ts";

let seq = 0;
const event = (
  id: string,
  kind: SettleEvent["kind"] = "finished",
): SettleEvent => ({
  seq: ++seq,
  id: id as TerminalId,
  kind,
  at: 1_700_000_000_000,
});

const registry = (
  opts: {
    limit?: number;
    subLimit?: number;
    daemonSeq?: () => number;
    subscribeStates?: (
      filter: StateWatchFilter,
      scope: WatchScope,
      emit: (batch: StateWatchBatch) => void,
      seed?: ReadonlyMap<TerminalId, StateWatchAnnounced>,
    ) => StateWatchAttachment;
  } = {},
): WatchRegistry =>
  createWatchRegistry({
    log: silentLogger,
    daemonSeq: () => seq,
    subscribeStates: () => {
      throw new Error("this registry was built without a state watch");
    },
    ...opts,
  });

function fakeStateWatch() {
  const specs: StateWatchSpec[] = [];
  const seeds: Array<ReadonlyMap<TerminalId, StateWatchAnnounced> | undefined> =
    [];
  const budgets: Array<ReadonlyMap<TerminalId, StateWatchAnnounced>> = [];
  const live = new Map<
    number,
    { spec: StateWatchSpec; emit: (batch: StateWatchBatch) => void }
  >();
  let handle = 0;
  const stateEvent = (
    id: string,
    kind: PadiStateEvent["kind"],
  ): PadiStateEvent => ({
    seq: ++seq,
    id: id as TerminalId,
    kind,
    state: "waiting",
    since: 1_700_000_000_000,
    at: 1_700_000_060_000,
  });
  return {
    specs,
    seeds,
    budgets,
    liveCount: () => live.size,
    subscribeStates: (
      filter: StateWatchFilter,
      scope: WatchScope,
      emit: (batch: StateWatchBatch) => void,
      seed?: ReadonlyMap<TerminalId, StateWatchAnnounced>,
    ) => {
      const key = ++handle;
      const spec: StateWatchSpec = { ...filter, scope };
      specs.push(spec);
      seeds.push(seed);
      const counts = new Map<TerminalId, StateWatchAnnounced>(seed);
      budgets.push(counts);
      live.set(key, { spec, emit });
      emit([stateEvent("standing", "snapshot")]);
      return {
        stop: () => {
          live.delete(key);
        },
        counts,
      };
    },
    push(id: string, kind: PadiStateEvent["kind"]) {
      for (const { emit } of live.values()) emit([stateEvent(id, kind)]);
    },
  };
}

const acceptOne = (r: WatchRegistry, ...ids: string[]): void => {
  for (const id of ids) r.acceptSettle([event(id)]);
};

describe("watch registry", () => {
  it("buffers events that arrive while nobody is draining — THE point", () => {
    const r = registry();
    r.open("campaign");
    acceptOne(r, "a", "b", "c");
    const drained = r.drain("campaign");
    expect(drained.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(drained.dropped).toBe(0);
  });

  it("a drain is ACKNOWLEDGED, not destructive — an unacknowledged batch comes again", () => {
    const r = registry();
    r.open("campaign");
    acceptOne(r, "a");
    const first = r.drain("campaign");
    expect(first.events).toHaveLength(1);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
    expect(r.drain("campaign", first.ackAfter).events).toHaveLength(0);
  });

  it("acknowledging a batch does not discard events that arrived after it", () => {
    const r = registry();
    r.open("campaign");
    acceptOne(r, "a");
    const first = r.drain("campaign");
    acceptOne(r, "b");
    const second = r.drain("campaign", first.ackAfter);
    expect(second.events.map((e) => e.id)).toEqual(["b"]);
  });

  it("a stale acknowledgement is ignored rather than rewinding the watermark", () => {
    const r = registry();
    r.open("campaign");
    acceptOne(r, "a", "b");
    const all = r.drain("campaign");
    expect(r.drain("campaign", all.ackAfter).events).toHaveLength(0);
    expect(r.drain("campaign", 0).events).toHaveLength(0);
  });

  it("RE-OPENING a name keeps the queue — a supervisor restart does not lose it", () => {
    const r = registry();
    r.open("campaign");
    acceptOne(r, "a");
    const { sub, reattached } = r.open("campaign");
    expect(reattached).toBe(true);
    expect(sub.feed.buffer).toHaveLength(1);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("a FRESH subscription refuses history at or below its watermark, even if it arrives late", () => {
    const stale = event("a");
    const r = registry({ daemonSeq: () => stale.seq });
    r.open("late");
    r.acceptSettle([stale]);
    expect(r.drain("late").events).toEqual([]);
    r.acceptSettle([event("b")]);
    expect(r.drain("late").events.map((e) => e.id)).toEqual(["b"]);
  });

  it("a FRESH subscription starts acknowledged at the daemon's current sequence", () => {
    let clock = 0;
    const r = registry({ daemonSeq: () => clock });
    clock = 41;
    const { sub, reattached } = r.open("late");
    expect(reattached).toBe(false);
    expect(sub.acknowledged).toBe(41);
  });

  it("scopes to an id list, and widens back to all when re-opened without one", () => {
    const r = registry();
    r.open("narrow", { scope: scopeOf({ ids: ["a" as TerminalId] }) });
    acceptOne(r, "a", "b");
    const first = r.drain("narrow");
    expect(first.events.map((e) => e.id)).toEqual(["a"]);

    r.open("narrow");
    acceptOne(r, "b");
    expect(r.drain("narrow", first.ackAfter).events.map((e) => e.id)).toEqual([
      "b",
    ]);
  });

  it("muting an id is fail-open — the others still arrive, a stale mute is inert", () => {
    const r = registry();
    r.open("campaign", {
      scope: scopeOf({ mute: ["self" as TerminalId, "gone" as TerminalId] }),
    });
    acceptOne(r, "self", "lane", "gone");
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["lane"]);
  });

  it("NARROWING the scope drops what the queue just stopped caring about", () => {
    const r = registry();
    r.open("both", {
      scope: scopeOf({ ids: ["a" as TerminalId, "b" as TerminalId] }),
    });
    acceptOne(r, "a", "b");
    r.open("both", { scope: scopeOf({ ids: ["a" as TerminalId] }) });
    expect(r.drain("both").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("REPORTS overflow instead of truncating silently", () => {
    const r = registry({ limit: 3 });
    r.open("campaign");
    acceptOne(r, "a", "b", "c", "d", "e");
    const drained = r.drain("campaign");
    expect(drained.events.map((e) => e.id)).toEqual(["c", "d", "e"]);
    expect(drained.dropped).toBe(2);
    expect(r.drain("campaign").dropped).toBe(2);
    expect(r.drain("campaign", drained.ackAfter).dropped).toBe(0);
  });

  it("a drop that lands AFTER a reported batch survives that batch's ack", () => {
    const r = registry({ limit: 2 });
    r.open("campaign");
    acceptOne(r, "a", "b", "c");
    const first = r.drain("campaign");
    expect(first.dropped).toBe(1);
    acceptOne(r, "d", "e");
    expect(r.drain("campaign", first.ackAfter).dropped).toBe(2);
  });

  it("IGNORES an acknowledgement from a previous daemon generation — the restart-recovery trap", () => {
    let clock = 0;
    const r = registry({ daemonSeq: () => clock });
    r.open("campaign");
    r.drain("campaign", 5_000);
    const fresh = event("a");
    clock = fresh.seq;
    r.acceptSettle([fresh]);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("REFUSES to open past the subscription cap rather than evicting somebody else's queue", () => {
    const r = registry({ subLimit: 2 });
    r.open("one");
    r.open("two");
    expect(() => r.open("one")).not.toThrow();
    expect(() => r.open("three")).toThrow(/already open/);
    acceptOne(r, "a");
    expect(r.drain("one").events).toHaveLength(1);
  });

  it("REFUSES a drain against a name nobody opened, naming what IS open", () => {
    const r = registry();
    r.open("campaign");
    expect(() => r.drain("campiagn")).toThrow(WatchSubscriptionNotFound);
    try {
      r.drain("campiagn");
    } catch (err) {
      expect((err as WatchSubscriptionNotFound).known).toEqual(["campaign"]);
    }
  });

  it("rings the doorbell only for subscriptions the event is in scope for", () => {
    const r = registry();
    const rings = { all: 0, a: 0 };
    r.onPulse("all", () => {
      rings.all += 1;
    });
    r.onPulse("just-a", () => {
      rings.a += 1;
    });
    r.open("all");
    r.open("just-a", { scope: scopeOf({ ids: ["a" as TerminalId] }) });
    acceptOne(r, "b");
    expect(rings.all).toBe(1);
    expect(rings.a).toBe(0);
  });

  it("rings ONCE per frame, not once per event — that is what a doorbell means", () => {
    const r = registry();
    let rings = 0;
    r.onPulse("campaign", () => {
      rings += 1;
    });
    r.open("campaign");
    r.acceptSettle([event("a"), event("b"), event("c")]);
    expect(rings).toBe(1);
    expect(r.drain("campaign").events).toHaveLength(3);
  });

  it("a pulse listener survives a close and re-open of the name it watches", () => {
    const r = registry();
    let rings = 0;
    r.onPulse("campaign", () => {
      rings += 1;
    });
    r.open("campaign");
    acceptOne(r, "a");
    expect(rings).toBe(1);
    r.close("campaign");
    expect(rings).toBe(2);
    r.open("campaign");
    acceptOne(r, "b");
    expect(rings).toBe(3);
  });

  it("closing RINGS even when the subscription never pulsed, so a parked consumer learns it is gone", () => {
    const r = registry();
    let rings = 0;
    r.onPulse("campaign", () => {
      rings += 1;
    });
    r.open("campaign");
    r.close("campaign");
    expect(rings).toBe(1);
    expect(() => r.drain("campaign")).toThrow(WatchSubscriptionNotFound);
  });

  it("REFUSES a close against a name nobody opened rather than answering `false`", () => {
    const r = registry();
    r.open("campaign");
    r.close("campaign");
    expect(() => r.close("campaign")).toThrow(WatchSubscriptionNotFound);
  });
});

describe("watch registry — a subscription that named the agent-state knobs", () => {
  const filter = {
    states: new Set(["waiting"] as const),
    heldForMs: 60_000,
    nagMs: 300_000,
  };

  it("is fed by the state watch, and its SNAPSHOT is already queued when open returns", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", { filter });
    expect(r.drain("supervise").events.map((e) => e.kind)).toEqual([
      "snapshot",
    ]);
  });

  it("re-enters the queue on the NAG — an ignored terminal comes back", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", { filter });
    watch.push("a", "transition");
    watch.push("a", "nag");
    watch.push("a", "nag");
    expect(r.drain("supervise").events.map((e) => e.kind)).toEqual([
      "snapshot",
      "transition",
      "nag",
      "nag",
    ]);
  });

  it("threads the subscription's OWN scope into the state watch — one id list, not two", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", {
      scope: scopeOf({ ids: ["a" as TerminalId] }),
      filter,
    });
    expect([...(watch.specs[0]?.scope.include ?? [])]).toEqual(["a"]);
    r.open("fleet", { filter });
    expect(watch.specs[1]?.scope.include).toBeUndefined();
  });

  it("threads ignoreIds into the state watch the same way — a mute, not a roster", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", {
      scope: scopeOf({ mute: ["self" as TerminalId] }),
      filter,
    });
    expect([...(watch.specs[0]?.scope.mute ?? [])]).toEqual(["self"]);
    r.open("fleet", { filter });
    expect(watch.specs[1]?.scope.mute).toBeUndefined();
  });

  it("RE-opening replaces the attachment rather than stacking one — a nag is never doubled", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", { filter });
    r.open("supervise", { filter });
    expect(watch.liveCount()).toBe(1);
    expect(r.drain("supervise").events.map((e) => e.kind)).toEqual([
      "snapshot",
      "snapshot",
    ]);
    watch.push("a", "nag");
    expect(
      r.drain("supervise").events.filter((e) => e.kind === "nag"),
    ).toHaveLength(1);
  });

  it("a re-open that CHANGES the question replaces the queue rather than mixing two vocabularies", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("campaign");
    acceptOne(r, "a");
    r.open("campaign", { filter });
    expect(r.drain("campaign").events.map((e) => e.kind)).toEqual(["snapshot"]);
  });

  it("a re-open that RESTATES the same question keeps the queue", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("campaign", { filter });
    watch.push("a", "nag");
    r.open("campaign", { filter: { ...filter, states: new Set(["waiting"]) } });
    expect(r.drain("campaign").events.map((e) => e.kind)).toEqual([
      "snapshot",
      "nag",
      "snapshot",
    ]);
  });

  it("hands the previous attachment's BUDGET to its successor — a spent cap is not re-charged on the ordinary restart", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", { filter });
    expect(watch.seeds[0]).toBeUndefined();
    r.open("supervise", {
      filter: { ...filter, states: new Set(["waiting"]) },
    });
    expect(watch.seeds[1]).toBe(watch.budgets[0]);
  });

  it("a re-asked QUESTION starts a fresh budget — the re-opened watch owes its cap its own reminders", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", {
      filter: { ...filter, heldForMs: 0, nagMs: 60_000, nagCount: 3 },
    });
    r.open("supervise", {
      filter: { ...filter, heldForMs: 60_000, nagMs: 60_000, nagCount: 3 },
    });
    expect(watch.seeds[1]).toBeUndefined();
  });

  it("a re-open that NARROWS the states drops the answers to the wider question", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("campaign", {
      filter: { ...filter, states: new Set(["waiting", "awaiting"]) },
    });
    watch.push("a", "nag");
    r.open("campaign", { filter });
    expect(r.drain("campaign").events.map((e) => e.kind)).toEqual(["snapshot"]);
  });

  it("CLOSING detaches it — a closed subscription cannot still be nagging", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", { filter });
    r.close("supervise");
    expect(watch.liveCount()).toBe(0);
  });

  it("DISPOSING detaches every attachment", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("one", { filter });
    r.open("two", { filter });
    r.dispose();
    expect(watch.liveCount()).toBe(0);
  });

  it("is NOT also fed the settle detector — one subscription, one vocabulary", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", { filter });
    r.open("plain");
    acceptOne(r, "a");
    expect(r.drain("supervise").events.map((e) => e.kind)).toEqual([
      "snapshot",
    ]);
    expect(r.drain("plain").events.map((e) => e.kind)).toEqual(["finished"]);
  });

  it("never invents a feed — a filtered open reaches the state watch it was BUILT with", () => {
    const r = registry();
    expect(() => r.open("supervise", { filter })).toThrow(
      /built without a state watch/,
    );
  });
});

describe("watch registry — the MCP face under a repainting idle terminal", () => {
  function wired() {
    const h = stateWatchHarness();
    const r = createWatchRegistry({
      log: silentLogger,
      daemonSeq: () => h.seq.last(),
      subscribeStates: (filter, scope, emit) =>
        h.hub.subscribe(specOf(filter, scope), emit),
    });
    return { h, r };
  }

  it("does not ring the doorbell for a repaint — a supervisor is not woken once a second", async () => {
    const { h, r } = wired();
    h.observe(frame({ a: { agent: makeAgent("tool_use") } }));
    await settled();

    let rings = 0;
    r.onPulse("campaign", () => {
      rings += 1;
    });
    r.open("campaign", {
      filter: { states: new Set(["waiting"]), heldForMs: 60_000 },
    });
    rings = 0;

    h.observe(frame({ a: { agent: makeAgent("waiting") } }));
    await settled();
    for (let i = 1; i < 60; i += 1) {
      h.advance(1_000);
      h.observe(
        frame({ a: { agent: makeAgent("waiting"), lastActivityAt: h.now() } }),
      );
      await settled();
    }
    expect(rings).toBe(0);
    expect(r.drain("campaign").events).toEqual([]);

    h.advance(1_000);
    expect(rings).toBe(1);
    expect(r.drain("campaign").events.map((e) => e.kind)).toEqual([
      "transition",
    ]);
  });
});
