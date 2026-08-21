/**
 * Pins the standing subscriptions — and above all the property they exist for:
 * an event that lands while NOBODY is draining is still there afterwards. That
 * is the difference between this and the edge-triggered `wait_*` tools, and it
 * is the seam a coordinator's dropped merge-ready report fell through.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { WatchSubscriptionNotFound } from "../errors.ts";
import type { PadiStateEvent } from "../surface.ts";
import {
  frame,
  makeAgent,
  settled,
  silentLogger,
  stateWatchHarness,
} from "./attentionFixture.testlib.ts";
import type { SettleEvent } from "./settleEvents.ts";
import type {
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

/** A registry whose `daemonSeq` tracks the module counter `event()` mints from —
 *  i.e. the daemon's real high-water mark, which is what the stale-cursor guard
 *  checks an acknowledgement against. A test that wants to model a cursor from a
 *  PREVIOUS daemon generation overrides it. */
const registry = (
  opts: {
    limit?: number;
    subLimit?: number;
    daemonSeq?: () => number;
    subscribeStates?: (
      filter: StateWatchFilter,
      ids: ReadonlySet<TerminalId> | undefined,
      emit: (batch: StateWatchBatch) => void,
    ) => () => void;
  } = {},
): WatchRegistry =>
  createWatchRegistry({
    log: silentLogger,
    daemonSeq: () => seq,
    // Queue-only tests have no state watch. A filtered `open` in one is a test
    // bug, so the stub SAYS so rather than opening a subscription nothing feeds
    // — the registry itself no longer admits being built without one.
    subscribeStates: () => {
      throw new Error("this registry was built without a state watch");
    },
    ...opts,
  });

/** A stand-in agent-state watch: it records every spec it was subscribed with,
 *  answers each subscribe with a SNAPSHOT batch (as the real engine does), and
 *  hands the test a `push` to fire a later transition or nag into that same
 *  subscription. The engine's own decisions are pinned in `stateWatch.test.ts`;
 *  what these pins are about is what the QUEUE does with what it is handed. */
function fakeStateWatch() {
  const specs: StateWatchSpec[] = [];
  const live = new Map<
    number,
    { spec: StateWatchSpec; emit: (batch: StateWatchBatch) => void }
  >();
  let handle = 0;
  // The SAME module counter `event()` mints from — in the daemon both sources
  // share one sequence, and a subscription's acknowledgement watermark is only
  // meaningful because they do.
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
    /** How many attachments are live right now — a re-open that left the old one
     *  running would double every nag. */
    liveCount: () => live.size,
    subscribeStates: (
      filter: StateWatchFilter,
      ids: ReadonlySet<TerminalId> | undefined,
      emit: (batch: StateWatchBatch) => void,
      ignoreIds?: ReadonlySet<TerminalId>,
    ) => {
      const key = ++handle;
      const spec: StateWatchSpec = {
        ...filter,
        ...(ids === undefined ? {} : { ids }),
        ...(ignoreIds === undefined ? {} : { ignoreIds }),
      };
      specs.push(spec);
      live.set(key, { spec, emit });
      // The real engine answers a subscribe with the currently-matching set.
      emit([stateEvent("standing", "snapshot")]);
      return () => {
        live.delete(key);
      };
    },
    /** Fire one event into every live attachment. */
    push(id: string, kind: PadiStateEvent["kind"]) {
      for (const { emit } of live.values()) emit([stateEvent(id, kind)]);
    },
  };
}

/** Accept one frame carrying a single event — the shape most of these pins want.
 *  `accept` takes a FRAME because that is what the source emits. */
const acceptOne = (r: WatchRegistry, ...ids: string[]): void => {
  for (const id of ids) r.acceptSettle([event(id)]);
};

describe("watch registry", () => {
  it("buffers events that arrive while nobody is draining — THE point", () => {
    const r = registry();
    r.open("campaign");
    // Three workers settle while the supervisor is busy elsewhere.
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
    // The caller never came back with the ack — its reply was lost to a host
    // timeout, an interruption, a dropped socket. The event MUST still be here;
    // a destructive read would have discarded a report nobody ever saw.
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
    // Once acknowledged, it is gone.
    expect(r.drain("campaign", first.ackAfter).events).toHaveLength(0);
  });

  it("acknowledging a batch does not discard events that arrived after it", () => {
    const r = registry();
    r.open("campaign");
    acceptOne(r, "a");
    const first = r.drain("campaign");
    // `b` lands while the caller is still processing the first batch.
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
    // A retry carrying an OLD ack must not un-acknowledge anything.
    expect(r.drain("campaign", 0).events).toHaveLength(0);
  });

  it("RE-OPENING a name keeps the queue — a supervisor restart does not lose it", () => {
    const r = registry();
    r.open("campaign");
    acceptOne(r, "a");
    // The MCP process died and came back; the agent re-opens the same name.
    const { sub, reattached } = r.open("campaign");
    expect(reattached).toBe(true);
    expect(sub.feed.buffer).toHaveLength(1);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("a FRESH subscription refuses history at or below its watermark, even if it arrives late", () => {
    // `open` reads the watermark while a settle frame may already be in flight
    // to the sinks. Letting that frame land would make the subscription's own
    // promise — "reports what happens NEXT" — false on its very first drain.
    const stale = event("a");
    const r = registry({ daemonSeq: () => stale.seq });
    r.open("late");
    r.acceptSettle([stale]); // exactly AT the watermark — already declined history
    expect(r.drain("late").events).toEqual([]);
    r.acceptSettle([event("b")]); // the first genuinely new one
    expect(r.drain("late").events.map((e) => e.id)).toEqual(["b"]);
  });

  it("a FRESH subscription starts acknowledged at the daemon's current sequence", () => {
    let clock = 0;
    const r = registry({ daemonSeq: () => clock });
    clock = 41;
    const { sub, reattached } = r.open("late");
    expect(reattached).toBe(false);
    // It reports what happens NEXT, not history the supervisor already handled.
    expect(sub.acknowledged).toBe(41);
  });

  it("scopes to an id list, and widens back to all when re-opened without one", () => {
    const r = registry();
    r.open("narrow", { ids: ["a" as TerminalId] });
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
      ignoreIds: ["self" as TerminalId, "gone" as TerminalId],
    });
    acceptOne(r, "self", "lane", "gone");
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["lane"]);
  });

  it("NARROWING the scope drops what the queue just stopped caring about", () => {
    const r = registry();
    r.open("both", { ids: ["a" as TerminalId, "b" as TerminalId] });
    acceptOne(r, "a", "b");
    // Re-scoping is a statement about the QUEUE, not only about future events —
    // otherwise `ids` and `buffer` describe two different subscriptions and the
    // next drain hands over an event the caller has said it does not want.
    r.open("both", { ids: ["a" as TerminalId] });
    expect(r.drain("both").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("REPORTS overflow instead of truncating silently", () => {
    const r = registry({ limit: 3 });
    r.open("campaign");
    acceptOne(r, "a", "b", "c", "d", "e");
    const drained = r.drain("campaign");
    // The newest survive; the count is how the caller learns the tail is partial.
    expect(drained.events.map((e) => e.id)).toEqual(["c", "d", "e"]);
    expect(drained.dropped).toBe(2);
    // The count rides until ACKNOWLEDGED, like the events it describes — a
    // caller whose reply was lost must still learn its history has a hole.
    expect(r.drain("campaign").dropped).toBe(2);
    expect(r.drain("campaign", drained.ackAfter).dropped).toBe(0);
  });

  it("a drop that lands AFTER a reported batch survives that batch's ack", () => {
    const r = registry({ limit: 2 });
    r.open("campaign");
    acceptOne(r, "a", "b", "c"); // one dropped
    const first = r.drain("campaign");
    expect(first.dropped).toBe(1);
    // Two more overflow while the caller is still processing the first batch.
    acceptOne(r, "d", "e");
    // `after` acknowledges events at or below a SEQ; a drop count has no seq, so
    // only the drops the acknowledged batch actually REPORTED are covered by it.
    // Zeroing the whole counter would erase these two exactly as silently as the
    // truncation this module refuses to do.
    expect(r.drain("campaign", first.ackAfter).dropped).toBe(2);
  });

  it("IGNORES an acknowledgement from a previous daemon generation — the restart-recovery trap", () => {
    // `seq` restarts at 0 on every padi boot while a supervisor keeps passing
    // back the `ackAfter` it remembers, and nothing on the wire tells it a
    // restart happened. Taken as truth, that cursor sets a watermark no future
    // event can climb past and `accept` discards every settle for the rest of
    // the daemon's life — silent, permanent blindness, which is the exact
    // failure this module exists to remove.
    let clock = 0;
    const r = registry({ daemonSeq: () => clock });
    r.open("campaign");
    // A cursor from before the restart, far beyond anything this daemon emitted.
    r.drain("campaign", 5_000);
    // The daemon's own sequence advances normally afterwards.
    const fresh = event("a");
    clock = fresh.seq;
    r.acceptSettle([fresh]);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("REFUSES to open past the subscription cap rather than evicting somebody else's queue", () => {
    const r = registry({ subLimit: 2 });
    r.open("one");
    r.open("two");
    // Re-opening an EXISTING name is always fine — that is the reuse the cap is
    // there to encourage.
    expect(() => r.open("one")).not.toThrow();
    // A third NAME is refused: evicting a queue to make room would blind a
    // supervisor that did nothing wrong.
    expect(() => r.open("three")).toThrow(/already open/);
    // And the existing queues are untouched.
    acceptOne(r, "a");
    expect(r.drain("one").events).toHaveLength(1);
  });

  it("REFUSES a drain against a name nobody opened, naming what IS open", () => {
    const r = registry();
    r.open("campaign");
    // Answering `{events: []}` here would read to a supervisor exactly like a
    // quiet workspace — the failure this error class exists to make impossible.
    expect(() => r.drain("campiagn")).toThrow(WatchSubscriptionNotFound);
    try {
      r.drain("campiagn");
    } catch (err) {
      expect((err as WatchSubscriptionNotFound).known).toEqual(["campaign"]);
    }
  });

  it("refuses an EMPTY id list rather than silently watching everything", () => {
    const r = registry();
    expect(() => r.open("bad", { ids: [] })).toThrow(/could never match/);
  });

  it("refuses when ignoreIds covers every scoped id — the same never-match", () => {
    const r = registry();
    expect(() =>
      r.open("bad", {
        ids: ["self" as TerminalId],
        ignoreIds: ["self" as TerminalId],
      }),
    ).toThrow(/can never match/);
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
    r.open("just-a", { ids: ["a" as TerminalId] });
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
    // One fold retired three lanes: one fact, one ring. The drain behind it is
    // the authority on what happened.
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
    r.close("campaign"); // closing rings too, so a parked consumer re-drains
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
    // Nothing ever landed in this queue. Without the ring, a parked consumer
    // would wait out its whole timeout against a subscription that no longer
    // exists — the outcome the close is specifically here to prevent.
    r.close("campaign");
    expect(rings).toBe(1);
    expect(() => r.drain("campaign")).toThrow(WatchSubscriptionNotFound);
  });

  it("REFUSES a close against a name nobody opened rather than answering `false`", () => {
    const r = registry();
    r.open("campaign");
    r.close("campaign");
    // A boolean `false` reads to an agent as "there was nothing to report",
    // which is exactly the confusion `WatchSubscriptionNotFound` exists to end.
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
    // The whole point of the snapshot: a supervisor that just (re)attached is
    // told what is standing before it is told about anything that changes.
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
    // This is the property the settle feed could not have: one terminal, one
    // episode, reported again and again for as long as it keeps holding.
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
    r.open("supervise", { ids: ["a" as TerminalId], filter });
    expect([...(watch.specs[0]?.ids ?? [])]).toEqual(["a"]);
    r.open("fleet", { filter });
    // Omitting ids is the ABSENCE of a claim, so the fleet is watched — the
    // enumeration-blindness the optional list exists to end.
    expect(watch.specs[1]?.ids).toBeUndefined();
  });

  it("threads ignoreIds into the state watch the same way — a mute, not a roster", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", {
      ignoreIds: ["self" as TerminalId],
      filter,
    });
    expect([...(watch.specs[0]?.ignoreIds ?? [])]).toEqual(["self"]);
    r.open("fleet", { filter });
    expect(watch.specs[1]?.ignoreIds).toBeUndefined();
  });

  it("RE-opening replaces the attachment rather than stacking one — a nag is never doubled", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("supervise", { filter });
    r.open("supervise", { filter });
    expect(watch.liveCount()).toBe(1);
    // …and the re-open answered with a fresh snapshot of its own, on top of the
    // queue it preserved.
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
    // It was a settle subscription, and it has settle events queued.
    r.open("campaign");
    acceptOne(r, "a");
    // Now the supervisor adopts the state knobs. Handing it back its old
    // `finished` events would put two vocabularies in one queue for a caller
    // that has just named only one of them.
    r.open("campaign", { filter });
    expect(r.drain("campaign").events.map((e) => e.kind)).toEqual(["snapshot"]);
  });

  it("a re-open that RESTATES the same question keeps the queue", () => {
    const watch = fakeStateWatch();
    const r = registry({ subscribeStates: watch.subscribeStates });
    r.open("campaign", { filter });
    watch.push("a", "nag");
    // The ordinary restart path: same name, same knobs. The whole reason this is
    // keyed by a caller-chosen name is that the queue survives it.
    r.open("campaign", { filter: { ...filter, states: new Set(["waiting"]) } });
    expect(r.drain("campaign").events.map((e) => e.kind)).toEqual([
      "snapshot",
      "nag",
      "snapshot",
    ]);
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
    // `subscribeStates` is a required dependency now, so "a subscription with a
    // filter and nothing to feed it" is unbuildable rather than a runtime
    // surprise an hour into a daemon's life. What is left to pin is that the
    // registry does not quietly skip the attachment: a queue-only harness hears
    // from its own stub.
    const r = registry();
    expect(() => r.open("supervise", { filter })).toThrow(
      /built without a state watch/,
    );
  });
});

describe("watch registry — the MCP face under a repainting idle terminal", () => {
  /** The REAL engine behind a real queue, joined the way `servePadi` joins them
   *  — this is the seam the MCP face actually has, and the doorbell is the part
   *  of it the engine's own tests cannot see. */
  function wired() {
    const h = stateWatchHarness();
    const r = createWatchRegistry({
      log: silentLogger,
      // The hub's OWN counter — one sequence behind one queue, as `servePadi`
      // wires it. Two would leave the watermark reading numbers the buffer
      // never carries, and every event would be silently discarded.
      daemonSeq: () => h.seq.last(),
      subscribeStates: (filter, ids, emit, ignoreIds) =>
        h.hub.subscribe(specOf(filter, ids, ignoreIds), emit),
    });
    return { h, r };
  }

  it("does not ring the doorbell for a repaint — a supervisor is not woken once a second", async () => {
    // `watch_next` parks on the pulse and drains when it rings. A ring per
    // repaint would wake a supervising agent about once a second to be handed
    // an empty batch — the flood, arriving at the MCP face instead of the CLI's.
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
    // Sixty seconds of repainting, nothing owed, nothing rung, nothing queued.
    expect(rings).toBe(0);
    expect(r.drain("campaign").events).toEqual([]);

    // …and the hold that WAS owed rings exactly once, on schedule.
    h.advance(1_000);
    expect(rings).toBe(1);
    expect(r.drain("campaign").events.map((e) => e.kind)).toEqual([
      "transition",
    ]);
  });
});
