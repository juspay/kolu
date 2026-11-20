import type { PadiStateEvent } from "@kolu/padi-client/surface";
import { WATCH_SCOPE_ALL } from "@kolu/padi-client/watchScope";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  stateWatchHarness as harness,
  makeAgent,
  settled,
  anchored as terminals,
} from "./attentionFixture.testlib.ts";
import type { StateWatchSpec } from "./stateWatch.ts";

function collect(
  hub: ReturnType<typeof harness>["hub"],
  spec: Partial<StateWatchSpec> = {},
  seed?: Parameters<ReturnType<typeof harness>["hub"]["subscribe"]>[2],
) {
  const batches: Array<readonly PadiStateEvent[]> = [];
  const sub = hub.subscribe(
    {
      states: new Set(["waiting", "awaiting"] as const),
      heldForMs: 0,
      scope: WATCH_SCOPE_ALL,
      ...spec,
    },
    (batch) => batches.push(batch),
    seed,
  );
  return {
    batches,
    stop: sub.stop,
    counts: sub.counts,
    flat: () => batches.flat(),
  };
}

describe("createStateWatchHub", () => {
  it("emits a SNAPSHOT of the currently-matching set on subscribe — before any change", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();

    const { batches } = collect(h.hub);
    expect(batches[0]?.map((e) => [e.kind, e.id, e.state])).toEqual([
      ["snapshot", "a", "waiting"],
    ]);
  });

  it("emits an EMPTY first batch when nothing matches — silence is not an answer", () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    const { batches } = collect(h.hub);
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

  it("an idle agent REPAINTING once a second neither cancels nor restarts a pending hold — the #2177 killer", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("tool_use") } }));
    await settled();
    const { batches } = collect(h.hub, { heldForMs: 60_000 });
    batches.length = 0;

    const enteredAt = h.now();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(batches).toEqual([]);
    expect(h.armedAt()).toBe(enteredAt + 60_000);

    for (let i = 1; i < 60; i += 1) {
      h.advance(1_000);
      h.observe(
        terminals({
          a: { agent: makeAgent("waiting"), lastActivityAt: h.now() },
        }),
      );
      await settled();
    }
    expect(batches).toEqual([]);
    expect(h.armedAt()).toBe(enteredAt + 60_000);

    h.advance(1_000);
    const [event] = batches.flat();
    expect(event?.kind).toBe("transition");
    expect(event?.since).toBe(enteredAt);
    expect((event?.at ?? 0) - (event?.since ?? 0)).toBe(60_000);
  });

  it("byte churn under a WORKING agent never STARTS a hold", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("tool_use") } }));
    await settled();
    const { batches } = collect(h.hub, { heldForMs: 1_000 });
    batches.length = 0;

    for (let i = 1; i < 10; i += 1) {
      h.advance(1_000);
      h.observe(
        terminals({
          a: { agent: makeAgent("tool_use"), lastActivityAt: h.now() },
        }),
      );
      await settled();
    }
    expect(batches).toEqual([]);
    expect(h.armedAt()).toBeUndefined();
  });

  it("a repaint does not reset the NAG clock either — an ignored terminal still comes back on time", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000 });
    expect(batches.flat()).toHaveLength(1);

    for (let i = 1; i < 60; i += 1) {
      h.advance(1_000);
      h.observe(
        terminals({
          a: { agent: makeAgent("waiting"), lastActivityAt: h.now() },
        }),
      );
      await settled();
    }
    expect(batches.flat()).toHaveLength(1);
    h.advance(1_000);
    expect(batches.flat().map((e) => e.kind)).toEqual(["snapshot", "nag"]);
  });

  it("HOLDS a transition until the state has lasted --held-for", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    const { batches } = collect(h.hub, { heldForMs: 60_000 });
    batches.length = 0;

    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(batches).toEqual([]);
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
    expect(batches.flat().at(-1)?.since).toBe(10_000);
  });

  it("CAPS the nagging at nagCount reminders — nagging is FINITE", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000, nagCount: 2 });
    expect(batches.flat().map((e) => e.kind)).toEqual(["snapshot"]);

    h.advance(60_000);
    h.advance(60_000);
    expect(batches.flat().map((e) => e.kind)).toEqual([
      "snapshot",
      "nag",
      "nag",
    ]);

    expect(h.armedAt()).toBeUndefined();
    h.advance(3_600_000);
    expect(batches.flat()).toHaveLength(3);
  });

  it("a state CHANGE re-arms a spent cap — a resumed-and-parked terminal is a new event", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000, nagCount: 1 });
    h.advance(60_000);
    h.advance(600_000);
    expect(batches.flat().map((e) => e.kind)).toEqual(["snapshot", "nag"]);

    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    h.advance(60_000);
    h.advance(600_000);
    expect(batches.flat().map((e) => e.kind)).toEqual([
      "snapshot",
      "nag",
      "transition",
      "nag",
    ]);
  });

  it("a nag says WHICH reminder it is and how many follow — the last one is tellable", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000, nagCount: 2 });
    h.advance(60_000);
    h.advance(60_000);
    const [first, second, third] = batches.flat();
    expect(Object.hasOwn(first ?? {}, "nag")).toBe(false);
    expect(second?.nag).toEqual({ index: 1, left: 1 });
    expect(third?.nag).toEqual({ index: 2, left: 0 });
  });

  it("an UNCAPPED nag counts its reminders but names no end", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000 });
    h.advance(60_000);
    h.advance(60_000);
    const [, first, second] = batches.flat();
    expect(first?.nag).toEqual({ index: 1 });
    expect(Object.hasOwn(first?.nag ?? {}, "left")).toBe(false);
    expect(second?.nag).toEqual({ index: 2 });
  });

  it("a RE-ATTACH inherits the episode's budget — a spent cap stays spent", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const spec = { nagMs: 60_000, nagCount: 2 };
    const first = collect(h.hub, spec);
    h.advance(60_000);
    h.advance(60_000);
    expect(first.flat().map((e) => [e.kind, e.nag])).toEqual([
      ["snapshot", undefined],
      ["nag", { index: 1, left: 1 }],
      ["nag", { index: 2, left: 0 }],
    ]);
    first.stop();

    const second = collect(h.hub, spec, first.counts);
    expect(second.flat().map((e) => [e.kind, e.nag])).toEqual([
      ["snapshot", undefined],
    ]);
    h.advance(3_600_000);
    expect(second.flat()).toHaveLength(1);
  });

  it("an inherited budget CONTINUES the count — one episode, one sequence across attachments", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const spec = { nagMs: 60_000, nagCount: 3 };
    const first = collect(h.hub, spec);
    h.advance(60_000);
    first.stop();

    const second = collect(h.hub, spec, first.counts);
    expect(second.flat().map((e) => [e.kind, e.nag])).toEqual([
      ["snapshot", undefined],
    ]);
    h.advance(60_000);
    h.advance(60_000);
    expect(second.flat().map((e) => [e.kind, e.nag])).toEqual([
      ["snapshot", undefined],
      ["nag", { index: 2, left: 1 }],
      ["nag", { index: 3, left: 0 }],
    ]);
    h.advance(3_600_000);
    expect(second.flat()).toHaveLength(3);
  });

  it("a re-attach with a LARGER hold owes its first report as a first report — never a nag", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const first = collect(h.hub, { nagMs: 60_000, nagCount: 2 });
    h.advance(60_000);
    h.advance(60_000);
    expect(first.flat().map((e) => [e.kind, e.nag])).toEqual([
      ["snapshot", undefined],
      ["nag", { index: 1, left: 1 }],
      ["nag", { index: 2, left: 0 }],
    ]);
    first.stop();

    const second = collect(
      h.hub,
      { nagMs: 60_000, nagCount: 2, heldForMs: 600_000 },
      first.counts,
    );
    expect(second.flat()).toEqual([]);

    h.advance(600_000);
    expect(second.flat().map((e) => [e.kind, e.nag])).toEqual([
      ["transition", undefined],
    ]);
    expect(h.armedAt()).toBeUndefined();
    h.advance(3_600_000);
    expect(second.flat()).toHaveLength(1);
  });

  it("a seed whose terminal MOVED ON before the return starts the NEW episode at zero", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const spec = { nagMs: 60_000, nagCount: 1 };
    const first = collect(h.hub, spec);
    h.advance(60_000);
    first.stop();

    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const second = collect(h.hub, spec, first.counts);
    h.advance(60_000);
    h.advance(3_600_000);
    expect(second.flat().map((e) => [e.kind, e.nag])).toEqual([
      ["snapshot", undefined],
      ["nag", { index: 1, left: 0 }],
    ]);
  });

  it("reports ONCE when no nag is asked for", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub);
    h.advance(3_600_000);
    expect(batches.flat()).toHaveLength(1);
    expect(h.armedAt()).toBeUndefined();
  });

  it("stops nagging the moment the terminal is dealt with, and a RE-entry is a fresh transition", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000 });
    h.advance(60_000);
    expect(batches.flat().map((e) => e.kind)).toEqual(["snapshot", "nag"]);

    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    h.advance(600_000);
    expect(batches.flat()).toHaveLength(2);

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
      collect(h.hub, { scope: { include: new Set(["b" as TerminalId]) } })
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
    expect(batches.flat()).toHaveLength(1);
    expect(h.armedAt()).toBeUndefined();
  });

  it("a frame that MOVED nothing costs no flush — the producer is the byte cadence, not the agent's", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    const { batches } = collect(h.hub, { nagMs: 60_000 });
    batches.length = 0;

    const armed = h.armedAt();
    for (let i = 0; i < 5; i += 1) {
      h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    }
    await settled();
    expect(batches).toEqual([]);
    expect(h.armedAt()).toBe(armed);
  });

  it("still answers a subscription opened before the first LOOK, even when that frame moves nothing", async () => {
    const h = harness();
    const { batches } = collect(h.hub);
    h.observe(terminals());
    await settled();
    expect(batches).toEqual([[]]);
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
    const { batches } = collect(h.hub);
    expect(batches).toEqual([]);

    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(batches.flat().map((e) => [e.kind, e.id])).toEqual([
      ["snapshot", "a"],
    ]);
  });

  it("answers a boot-window subscription with an EMPTY snapshot once it has looked", async () => {
    const h = harness();
    const { batches } = collect(h.hub);
    h.observe(terminals({ a: { agent: makeAgent("thinking") } }));
    await settled();
    expect(batches).toEqual([[]]);
  });

  it("dates a hold from the frame that first saw the state, not from boot", async () => {
    const h = harness();
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
      {
        states: new Set(["waiting"] as const),
        heldForMs: 0,
        scope: WATCH_SCOPE_ALL,
      },
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

  it("an ignored id emits nothing — not a snapshot, not a transition, not a nag", async () => {
    const h = harness();
    h.observe(
      terminals({
        self: { agent: makeAgent("waiting") },
        lane: { agent: makeAgent("waiting") },
      }),
    );
    await settled();
    const { batches } = collect(h.hub, {
      scope: { mute: new Set(["self" as TerminalId]) },
      nagMs: 60_000,
    });
    expect(batches.flat().map((e) => [e.kind, e.id])).toEqual([
      ["snapshot", "lane"],
    ]);

    h.advance(60_000);
    expect(batches.flat().map((e) => [e.kind, e.id])).toEqual([
      ["snapshot", "lane"],
      ["nag", "lane"],
    ]);

    h.observe(
      terminals({
        self: { agent: makeAgent("thinking") },
        lane: { agent: makeAgent("thinking") },
      }),
    );
    await settled();
    h.observe(
      terminals({
        self: { agent: makeAgent("waiting") },
        lane: { agent: makeAgent("waiting") },
      }),
    );
    await settled();
    expect(batches.flat().map((e) => [e.kind, e.id])).toEqual([
      ["snapshot", "lane"],
      ["nag", "lane"],
      ["transition", "lane"],
    ]);
  });

  it("an unknown ignore id is inert — fail-open, a stale mute costs nothing", async () => {
    const h = harness();
    h.observe(terminals({ a: { agent: makeAgent("waiting") } }));
    await settled();
    expect(
      collect(h.hub, {
        scope: { mute: new Set(["gone" as TerminalId]) },
      })
        .flat()
        .map((e) => e.id),
    ).toEqual(["a"]);
  });
});
