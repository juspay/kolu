/**
 * Pins the push→pull bridge under the `watchStates` member — the seam between an
 * engine that CALLS you when something comes due and a surface stream that is
 * PULLED.
 *
 * Three properties, each of which is a silent failure if it breaks: the first
 * frame is the snapshot (a fence re-subscribe re-leads with fresh truth); a nag
 * that fires while nobody is pulling is still delivered on the next pull (a
 * supervisor mid-write must not lose the report); and ending the consumption
 * unsubscribes (a hung-up `kolu watch` must not leave the daemon holding a
 * timer for it).
 */

import { Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PadiStateEvent } from "../surface.ts";
import {
  frame,
  makeAgent,
  silentLogger,
  stateWatchHarness,
} from "./attentionFixture.testlib.ts";
import { stateWatchSource } from "./stateWatchStream.ts";

/** The shared harness, already looking at ONE idle terminal — every pin here is
 *  about what the STREAM does with what the hub hands it, so the fleet is a
 *  constant. */
function harness() {
  const h = stateWatchHarness();
  h.observe(frame({ a: { agent: makeAgent("waiting") } }));
  return h;
}

const NAG = {
  states: new Set(["waiting"] as const),
  heldForMs: 0,
  nagMs: 1_000,
};

function pull(hub: ReturnType<typeof harness>["hub"]) {
  const stream: Stream.Stream<readonly PadiStateEvent[]> = stateWatchSource(
    hub,
    NAG,
    silentLogger,
  );
  return Stream.toAsyncIterable(stream)[Symbol.asyncIterator]();
}

describe("stateWatchSource", () => {
  it("leads with the SNAPSHOT — the frame a re-subscribe re-seeds from", async () => {
    const h = harness();
    const it = pull(h.hub);
    const first = await it.next();
    expect(
      (first.value as readonly PadiStateEvent[]).map((e) => [e.kind, e.id]),
    ).toEqual([["snapshot", "a"]]);
    await it.return?.();
  });

  it("delivers a nag that fired while NOBODY was pulling", async () => {
    const h = harness();
    const it = pull(h.hub);
    await it.next();
    // The consumer is off writing to a slow pipe; the interval does not wait
    // for it, and the report must not be dropped on the floor.
    h.advance(1_000);
    h.advance(1_000);
    const a = await it.next();
    const b = await it.next();
    expect((a.value as readonly PadiStateEvent[])[0]?.kind).toBe("nag");
    expect((b.value as readonly PadiStateEvent[])[0]?.kind).toBe("nag");
    await it.return?.();
  });

  it("wakes a consumer that is already waiting when the nag fires", async () => {
    const h = harness();
    const it = pull(h.hub);
    await it.next();
    const pending = it.next();
    h.advance(1_000);
    expect(((await pending).value as readonly PadiStateEvent[])[0]?.kind).toBe(
      "nag",
    );
    await it.return?.();
  });

  it("a REPAINTING idle terminal produces no frames — the flood `kolu watch` used to be", async () => {
    // The CLI seam of the #2177 lesson. The old change tail relayed byte-level
    // churn, so an idle grok redrawing its prompt about once a second WAS the
    // feed. Here the same churn — a recency stamp advancing on every frame, the
    // adapter state never moving — must reach the socket as nothing at all.
    const h = harness();
    const it = pull(h.hub);
    await it.next(); // the snapshot

    let pulled = 0;
    void (async () => {
      for (;;) {
        const next = await it.next();
        if (next.done === true) return;
        pulled += 1;
      }
    })();

    for (let i = 1; i < 10; i += 1) {
      h.advance(100);
      h.observe(
        frame({ a: { agent: makeAgent("waiting"), lastActivityAt: h.now() } }),
      );
      await Promise.resolve();
    }
    // Under a second of wall time at a 1 s nag: nine repaints, zero lines.
    expect(pulled).toBe(0);

    // …and the nag that IS owed still arrives, on its own schedule.
    h.advance(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(pulled).toBe(1);
    await it.return?.();
  });

  it("UNSUBSCRIBES when the consumer ends — a hung-up watch stops holding the clock", async () => {
    const h = harness();
    const it = pull(h.hub);
    await it.next();
    expect(h.armedAt()).toBeDefined();
    await it.return?.();
    expect(h.armedAt()).toBeUndefined();
  });
});
