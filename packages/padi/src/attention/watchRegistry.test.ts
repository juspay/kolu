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

  it("a drain empties the queue — the same event is not served twice", () => {
    const r = createWatchRegistry();
    r.open("campaign");
    r.accept(event("a"));
    expect(r.drain("campaign").events).toHaveLength(1);
    expect(r.drain("campaign").events).toHaveLength(0);
  });

  it("RE-OPENING a name keeps the buffer — a supervisor restart does not lose its queue", () => {
    const r = createWatchRegistry();
    r.open("campaign");
    r.accept(event("a"));
    // The MCP process died and came back; the agent re-opens the same name.
    const reattached = r.open("campaign");
    expect(reattached.buffer).toHaveLength(1);
    expect(r.drain("campaign").events.map((e) => e.id)).toEqual(["a"]);
  });

  it("scopes to an id list, and widens back to all when re-opened without one", () => {
    const r = createWatchRegistry();
    r.open("narrow", ["a" as TerminalId]);
    r.accept(event("a"));
    r.accept(event("b"));
    expect(r.drain("narrow").events.map((e) => e.id)).toEqual(["a"]);

    r.open("narrow");
    r.accept(event("b"));
    expect(r.drain("narrow").events.map((e) => e.id)).toEqual(["b"]);
  });

  it("REPORTS overflow instead of truncating silently", () => {
    const r = createWatchRegistry({ limit: 3 });
    r.open("campaign");
    for (const id of ["a", "b", "c", "d", "e"]) r.accept(event(id));
    const drained = r.drain("campaign");
    // The newest survive; the count is how the caller learns the tail is partial.
    expect(drained.events.map((e) => e.id)).toEqual(["c", "d", "e"]);
    expect(drained.dropped).toBe(2);
    // And the drop count resets — it describes one drain, not all history.
    expect(r.drain("campaign").dropped).toBe(0);
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

  it("a parked drain wakes the moment an event lands", async () => {
    const r = createWatchRegistry();
    r.open("campaign");
    const parked = r.waitFor("campaign", { timeoutMs: 5_000 });
    r.accept(event("a"));
    expect(await parked).toBe(true);
    expect(r.drain("campaign").events).toHaveLength(1);
  });

  it("a drain parked on an ALREADY-full queue returns at once", async () => {
    const r = createWatchRegistry();
    r.open("campaign");
    r.accept(event("a"));
    expect(await r.waitFor("campaign", { timeoutMs: 5_000 })).toBe(true);
  });

  it("a parked drain gives up on timeout WITHOUT consuming anything", async () => {
    const r = createWatchRegistry();
    r.open("campaign");
    expect(await r.waitFor("campaign", { timeoutMs: 5 })).toBe(false);
    // A timeout is not a loss: the next call still finds whatever arrives.
    r.accept(event("a"));
    expect(r.drain("campaign").events).toHaveLength(1);
  });

  it("an aborted drain returns false and unregisters itself", async () => {
    const r = createWatchRegistry();
    r.open("campaign");
    const ac = new AbortController();
    const parked = r.waitFor("campaign", { signal: ac.signal });
    ac.abort();
    expect(await parked).toBe(false);
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
    r.close("campaign");
    r.open("campaign");
    r.accept(event("b"));
    expect(rings).toBe(2);
  });

  it("closing releases anyone parked rather than hanging them forever", async () => {
    const r = createWatchRegistry();
    r.open("campaign");
    const parked = r.waitFor("campaign", { timeoutMs: 5_000 });
    r.close("campaign");
    expect(await parked).toBe(true);
    expect(r.close("campaign")).toBe(false);
  });
});
