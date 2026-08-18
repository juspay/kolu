/**
 * Pins the agent-state watch — the four supervision capabilities, at the one
 * place they are implemented.
 *
 * Every assertion drives an INJECTED clock and an INJECTED timer, so nothing
 * here waits on wall time and a nag interval is exercised at its exact
 * boundary rather than approximately. The two are separate injections on
 * purpose: a bug where the engine arms a timer at the wrong deadline is
 * invisible to a test that fires every pending timer regardless.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import type { PadiStateEvent } from "../surface.ts";
import {
  anchored as terminals,
  makeAgent,
  settled,
  stateWatchHarness as harness,
} from "./attentionFixture.testlib.ts";
import type { StateWatchSpec } from "./stateWatch.ts";

/** Subscribe and collect every batch. */
function collect(
  hub: ReturnType<typeof harness>["hub"],
  spec: Partial<StateWatchSpec> = {},
) {
  const batches: Array<readonly PadiStateEvent[]> = [];
  const stop = hub.subscribe(
    {
      states: new Set(["waiting", "awaiting"] as const),
      heldForMs: 0,
      ...spec,
    },
    (batch) => batches.push(batch),
  );
  return { batches, stop, flat: () => batches.flat() };
}

describe("createStateWatchHub", () => {
  it("emits a SNAPSHOT of the currently-matching set on subscribe — before any change", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();

    const { batches } = collect(h.hub);
    // The very first batch, and it describes the world as it already was.
    expect(batches[0]?.map((e) => [e.kind, e.id, e.state])).toEqual([
      ["snapshot", "a", "waiting"],
    ]);
  });

  it("emits an EMPTY first batch when nothing matches — silence is not an answer", () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    const { batches } = collect(h.hub);
    // A stream consumer needs a snapshot boundary whether or not anything is
    // standing; "nothing is neglected" is a fact, not the absence of one.
    expect(batches).toEqual([[]]);
  });

  it("does not deliver on the DERIVATION's stack — observe returns before any subscriber runs", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    const { batches } = collect(h.hub);
    batches.length = 0;
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    expect(batches).toEqual([]);
    await settled();
    expect(batches.flat().map((e) => e.kind)).toEqual(["transition"]);
  });

  it("HOLDS a transition until the state has lasted --held-for", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    const { batches } = collect(h.hub, { heldForMs: 60_000 });
    batches.length = 0;

    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    // Entered the state — but not for long enough to be worth anyone's
    // attention yet.
    expect(batches).toEqual([]);
    // …and the hub is WAITING for exactly that moment, not polling.
    expect(h.armedAt()).toBe(h.now() + 60_000);

    h.advance(59_999);
    expect(batches).toEqual([]);
    h.advance(1);
    expect(batches.flat().map((e) => [e.kind, e.id])).toEqual([
      ["transition", "a"],
    ]);
  });

  it("never reports a state that did not survive the hold — the debounce is the point", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    const { batches } = collect(h.hub, { heldForMs: 60_000 });
    batches.length = 0;

    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    h.advance(30_000);
    // Handed more work inside the window: the agent's turn resumed, so nobody
    // was ever told it had ended.
    h.observe(terminals({ a: { agent: makeAgent("tool_use") } }));
    await settled();
    h.advance(60_000);
    expect(batches.flat()).toEqual([]);
  });

  it("NAGS on the interval for as long as the state keeps holding", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 300_000 });
    // The snapshot is the first report; the nag clock starts from it.
    expect(batches.flat().map((e) => e.kind)).toEqual(["snapshot"]);

    h.advance(299_999);
    expect(batches.flat()).toHaveLength(1);
    h.advance(1);
    h.advance(300_000);
    h.advance(300_000);
    expect(batches.flat().map((e) => e.kind)).toEqual([
      "snapshot",
      "nag",
      "nag",
      "nag",
    ]);
    // Every repeat still says how long it has been standing there.
    expect(batches.flat().at(-1)?.since).toBe(10_000);
  });

  it("reports ONCE when no nag is asked for", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub);
    h.advance(3_600_000);
    expect(batches.flat()).toHaveLength(1);
    // Nothing to wake up for.
    expect(h.armedAt()).toBeUndefined();
  });

  it("stops nagging the moment the terminal is dealt with, and a RE-entry is a fresh transition", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000 });
    h.advance(60_000);
    expect(batches.flat().map((e) => e.kind)).toEqual(["snapshot", "nag"]);

    // Someone gave it work.
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    h.advance(600_000);
    expect(batches.flat()).toHaveLength(2);

    // It finished again — a NEW episode, so a transition rather than a nag
    // against the old one.
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(batches.flat().map((e) => e.kind)).toEqual([
      "snapshot",
      "nag",
      "transition",
    ]);
    expect(batches.flat().at(-1)?.since).toBe(h.now());
  });

  it("reports only the states asked for", async () => {
    const h = harness();
    h.observe(
      terminals({
        a: { agent: makeAgent("waiting") },
        b: { agent: makeAgent("awaiting_user") },
        c: { agent: makeAgent("thinking") },
      }),
    );
    await settled();
    const { flat } = collect(h.hub, { states: new Set(["awaiting"] as const) });
    expect(flat().map((e) => [e.id, e.state])).toEqual([["b", "awaiting"]]);
  });

  it("scopes to an id when asked, and to the whole fleet when not", async () => {
    const h = harness();
    h.observe(
      terminals({
        a: { agent: makeAgent("waiting") },
        b: { agent: makeAgent("waiting") },
      }),
    );
    await settled();
    expect(
      collect(h.hub)
        .flat()
        .map((e) => e.id),
    ).toEqual(["a", "b"]);
    expect(
      collect(h.hub, { ids: new Set(["b" as TerminalId]) })
        .flat()
        .map((e) => e.id),
    ).toEqual(["b"]);
  });

  it("carries the lane attribution a subscriber cannot cheaply re-derive", async () => {
    const h = harness();
    h.observe(
      terminals({
        a: {
          agent: makeAgent("waiting"),
          parentId: "boss",
          intent: "fix the parser",
        },
      }),
    );
    await settled();
    const [event] = collect(h.hub).flat();
    expect(event?.parentId).toBe("boss");
    expect(event?.intent).toBe("fix the parser");
  });

  it("omits attribution rather than sending an explicit undefined (#17)", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const [event] = collect(h.hub).flat();
    expect(Object.hasOwn(event ?? {}, "parentId")).toBe(false);
    expect(Object.hasOwn(event ?? {}, "intent")).toBe(false);
  });

  it("a terminal with NO live agent holds no state and is never reported", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: null } }));
    await settled();
    expect(
      collect(h.hub, {
        states: new Set(["waiting", "awaiting", "working"] as const),
      }).flat(),
    ).toEqual([]);
  });

  it("a terminal that LEAVES stops nagging and leaves no announcement behind", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000 });
    expect(batches.flat()).toHaveLength(1);

    h.observe(terminals());
    await settled();
    h.advance(600_000);
    // Nothing to nag about, and nothing to wake for.
    expect(batches.flat()).toHaveLength(1);
    expect(h.armedAt()).toBeUndefined();
  });

  it("wakes at the EARLIEST deadline across subscriptions, once", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    collect(h.hub, { heldForMs: 300_000 });
    collect(h.hub, { heldForMs: 30_000 });
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(h.armedAt()).toBe(h.now() + 30_000);
  });

  it("WAITS for the first observation before answering 'nothing is neglected'", async () => {
    const h = harness();
    // Opened in padi's boot window: the graph is built, the endpoint has not
    // adopted kaval's terminals yet. An empty snapshot here would be a hub that
    // has seen no fleet telling its owner the fleet is calm.
    const { batches } = collect(h.hub);
    expect(batches).toEqual([]);

    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    // …and when it has looked, the first frame is still a SNAPSHOT — that
    // subscription was never there for the edge.
    expect(batches.flat().map((e) => [e.kind, e.id])).toEqual([
      ["snapshot", "a"],
    ]);
  });

  it("answers a boot-window subscription with an EMPTY snapshot once it has looked", async () => {
    const h = harness();
    const { batches } = collect(h.hub);
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    // Still the snapshot boundary a stream consumer needs — just an honest one.
    expect(batches).toEqual([[]]);
  });

  it("dates a hold from the frame that first saw the state, not from boot", async () => {
    const h = harness();
    // The serve-time pre-adopt frame — padi's `urgency` derivation running
    // before the endpoint has adopted kaval's terminals — never reaches the hub
    // at all; its producer gates it (`servePadi`'s urgency cell). What reaches
    // the hub is a real frame, and `since` is that frame's stamp.
    h.set(50_000);
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(collect(h.hub).flat()[0]?.since).toBe(50_000);
  });

  it("an UNSUBSCRIBED consumer stops being fed, and stops holding the clock", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches, stop } = collect(h.hub, { nagMs: 60_000 });
    stop();
    h.advance(600_000);
    expect(batches.flat()).toHaveLength(1);
    expect(h.armedAt()).toBeUndefined();
  });

  it("stamps ONE `at` per batch and a strictly increasing seq", async () => {
    const h = harness();
    h.observe(
      terminals({
        a: { agent: makeAgent("waiting") },
        b: { agent: makeAgent("awaiting_user") },
      }),
    );
    await settled();
    const [batch] = collect(h.hub).batches;
    expect(batch?.map((e) => e.at)).toEqual([h.now(), h.now()]);
    expect(batch?.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("contains a throwing subscriber to its own batch", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    h.hub.subscribe(
      { states: new Set(["waiting"] as const), heldForMs: 0 },
      () => {
        throw new Error("boom");
      },
    );
    const { batches } = collect(h.hub);
    batches.length = 0;
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(batches.flat().map((e) => e.kind)).toEqual(["transition"]);
  });
});
