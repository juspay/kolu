import type { PadiStateEvent } from "@kolu/padi-client/surface";
import { WATCH_SCOPE_ALL } from "@kolu/padi-client/watchScope";
import { Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  frame,
  makeAgent,
  silentLogger,
  stateWatchHarness,
} from "./attentionFixture.testlib.ts";
import { stateWatchSource } from "./stateWatchStream.ts";

function harness() {
  const h = stateWatchHarness();
  h.observe(frame({ a: { agent: makeAgent("waiting") } }));
  return h;
}

const NAG = {
  states: new Set(["waiting"] as const),
  heldForMs: 0,
  nagMs: 1_000,
  scope: WATCH_SCOPE_ALL,
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
    const h = harness();
    const it = pull(h.hub);
    await it.next();

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
    expect(pulled).toBe(0);

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
