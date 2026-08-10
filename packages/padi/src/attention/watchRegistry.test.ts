/**
 * Pins the standing subscriptions — and above all the property they exist for:
 * an event that lands while NOBODY is draining is still there afterwards. That
 * is the difference between this and the edge-triggered `wait_*` tools, and it
 * is the seam a coordinator's dropped merge-ready report fell through.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { WatchSubscriptionNotFound } from "../errors.ts";
import type { SettleEvent } from "./settleEvents.ts";
import { createWatchRegistry } from "./watchRegistry.ts";

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

describe("watch registry", () => {
  it("buffers events that arrive while nobody is draining — THE point", () => {
    const r = createWatchRegistry();
    r.open("campaign");
    // Three workers settle while the supervisor is busy elsewhere.
    r.accept(event("a"));
    r.accept(event("b"));
    r.accept(event("c"));
    const drained = r.drain("campaign");
    expect(drained.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(drained.dropped).toBe(0);
  });

  it("a drain is ACKNOWLEDGED, not destructive — an unacknowledged batch comes again", () => {
    const r = createWatchRegistry();
    r.open("campaign");
    r.accept(event("a"));
    const first = r.drain("campaign");
    expect(first.events).toHaveLength(1);
    // The caller never came back with the cursor — its reply was lost to a host
    // timeout, an interruption, a dropped socket. The event MUST still be here;
    // a destructive read would have discarded a report nobody ever saw.
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
    // Once acknowledged, it is gone.
    expect(r.drain("campaign", first.cursor).events).toHaveLength(0);
  });

  it("acknowledging a batch does not discard events that arrived after it", () => {
    const r = createWatchRegistry();
    r.open("campaign");
    r.accept(event("a"));
    const first = r.drain("campaign");
    // `b` lands while the caller is still processing the first batch.
    r.accept(event("b"));
    const second = r.drain("campaign", first.cursor);
    expect(second.events.map((e) => e.id)).toEqual(["b"]);
  });

  it("a stale acknowledgement is ignored rather than rewinding the cursor", () => {
    const r = createWatchRegistry();
    r.open("campaign");
    r.accept(event("a"));
    r.accept(event("b"));
    const all = r.drain("campaign");
    expect(r.drain("campaign", all.cursor).events).toHaveLength(0);
    // A retry carrying an OLD cursor must not un-acknowledge anything.
    expect(r.drain("campaign", 0).events).toHaveLength(0);
  });

  it("RE-OPENING a name keeps the queue — a supervisor restart does not lose it", () => {
    const r = createWatchRegistry();
    r.open("campaign");
    r.accept(event("a"));
    // The MCP process died and came back; the agent re-opens the same name.
    const { sub, reattached } = r.open("campaign");
    expect(reattached).toBe(true);
    expect(sub.buffer).toHaveLength(1);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("a FRESH subscription starts acknowledged at the daemon's current sequence", () => {
    let clock = 0;
    const r = createWatchRegistry({ initialCursor: () => clock });
    clock = 41;
    const { sub, reattached } = r.open("late");
    expect(reattached).toBe(false);
    // It reports what happens NEXT, not history the supervisor already handled.
    expect(sub.cursor).toBe(41);
  });

  it("scopes to an id list, and widens back to all when re-opened without one", () => {
    const r = createWatchRegistry();
    r.open("narrow", ["a" as TerminalId]);
    r.accept(event("a"));
    r.accept(event("b"));
    const first = r.drain("narrow");
    expect(first.events.map((e) => e.id)).toEqual(["a"]);

    r.open("narrow");
    r.accept(event("b"));
    expect(r.drain("narrow", first.cursor).events.map((e) => e.id)).toEqual([
      "b",
    ]);
  });

  it("REPORTS overflow instead of truncating silently", () => {
    const r = createWatchRegistry({ limit: 3 });
    r.open("campaign");
    for (const id of ["a", "b", "c", "d", "e"]) r.accept(event(id));
    const drained = r.drain("campaign");
    // The newest survive; the count is how the caller learns the tail is partial.
    expect(drained.events.map((e) => e.id)).toEqual(["c", "d", "e"]);
    expect(drained.dropped).toBe(2);
    // The count rides until ACKNOWLEDGED, like the events it describes — a
    // caller whose reply was lost must still learn its history has a hole.
    expect(r.drain("campaign").dropped).toBe(2);
    expect(r.drain("campaign", drained.cursor).dropped).toBe(0);
  });

  it("REFUSES a drain against a name nobody opened, naming what IS open", () => {
    const r = createWatchRegistry();
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
    const r = createWatchRegistry();
    expect(() => r.open("bad", [])).toThrow(/could never match/);
  });

  it("rings the doorbell only for subscriptions the event is in scope for", () => {
    const r = createWatchRegistry();
    r.open("all");
    r.open("just-a", ["a" as TerminalId]);
    const before = { all: r.pulseOf("all"), a: r.pulseOf("just-a") };
    r.accept(event("b"));
    expect(r.pulseOf("all")).toBeGreaterThan(before.all);
    expect(r.pulseOf("just-a")).toBe(before.a);
  });

  it("a pulse listener survives a close and re-open of the name it watches", () => {
    const r = createWatchRegistry();
    let rings = 0;
    r.onPulse("campaign", () => {
      rings += 1;
    });
    r.open("campaign");
    r.accept(event("a"));
    expect(rings).toBe(1);
    r.close("campaign"); // closing rings too, so a parked consumer re-drains
    expect(rings).toBe(2);
    r.open("campaign");
    r.accept(event("b"));
    expect(rings).toBe(3);
  });

  it("closing RINGS, so a consumer parked on the doorbell re-drains and learns it is gone", () => {
    const r = createWatchRegistry();
    let rings = 0;
    r.onPulse("campaign", () => {
      rings += 1;
    });
    r.open("campaign");
    r.close("campaign");
    // Without the ring, a parked consumer would wait out its whole timeout
    // against a subscription that no longer exists.
    expect(rings).toBe(1);
    expect(() => r.drain("campaign")).toThrow(WatchSubscriptionNotFound);
    expect(r.close("campaign")).toBe(false);
  });
});
