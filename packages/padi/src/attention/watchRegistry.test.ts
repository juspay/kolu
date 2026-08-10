/**
 * Pins the standing subscriptions — and above all the property they exist for:
 * an event that lands while NOBODY is draining is still there afterwards. That
 * is the difference between this and the edge-triggered `wait_*` tools, and it
 * is the seam a coordinator's dropped merge-ready report fell through.
 */

import { pino } from "pino";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { WatchSubscriptionNotFound } from "../errors.ts";
import type { SettleEvent } from "./settleEvents.ts";
import { createWatchRegistry, type WatchRegistry } from "./watchRegistry.ts";

const silentLogger = pino({ level: "silent" });

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
  opts: { limit?: number; initialCursor?: () => number } = {},
): WatchRegistry => createWatchRegistry({ log: silentLogger, ...opts });

/** Accept one frame carrying a single event — the shape most of these pins want.
 *  `accept` takes a FRAME because that is what the source emits. */
const acceptOne = (r: WatchRegistry, ...ids: string[]): void => {
  for (const id of ids) r.accept([event(id)]);
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
    expect(sub.buffer).toHaveLength(1);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("a FRESH subscription starts acknowledged at the daemon's current sequence", () => {
    let clock = 0;
    const r = registry({ initialCursor: () => clock });
    clock = 41;
    const { sub, reattached } = r.open("late");
    expect(reattached).toBe(false);
    // It reports what happens NEXT, not history the supervisor already handled.
    expect(sub.acknowledged).toBe(41);
  });

  it("scopes to an id list, and widens back to all when re-opened without one", () => {
    const r = registry();
    r.open("narrow", ["a" as TerminalId]);
    acceptOne(r, "a", "b");
    const first = r.drain("narrow");
    expect(first.events.map((e) => e.id)).toEqual(["a"]);

    r.open("narrow");
    acceptOne(r, "b");
    expect(r.drain("narrow", first.ackAfter).events.map((e) => e.id)).toEqual([
      "b",
    ]);
  });

  it("NARROWING the scope drops what the queue just stopped caring about", () => {
    const r = registry();
    r.open("both", ["a" as TerminalId, "b" as TerminalId]);
    acceptOne(r, "a", "b");
    // Re-scoping is a statement about the QUEUE, not only about future events —
    // otherwise `ids` and `buffer` describe two different subscriptions and the
    // next drain hands over an event the caller has said it does not want.
    r.open("both", ["a" as TerminalId]);
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
    expect(() => r.open("bad", [])).toThrow(/could never match/);
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
    r.open("just-a", ["a" as TerminalId]);
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
    r.accept([event("a"), event("b"), event("c")]);
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
