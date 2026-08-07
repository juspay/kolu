/**
 * `implementSurfaces` serves a keyed MAP of independent surfaces as SIBLINGS
 * multiplexed over one transport — each namespaced by its key, NOT merged.
 *
 * This file pins:
 *   1. Wire tags land at `surface/<key>/<prim>/<verb>` for two sibling surfaces
 *      (no double-prefix — each sibling is re-walked with its own tag prefix,
 *      never raw-nested), and the bound handler set IS the composed group's tag
 *      set (D1's route-set identity).
 *   2. The three framework-reserved `system/*` members exist ONCE PER SIBLING
 *      and answer independently — the collision a bare `RpcGroup.merge` would
 *      have silently resolved last-writer-wins.
 *   3. A real invocation through `handlers["surface/<key>/<ns>/<verb>"]` works.
 *   4. The `connect` cell-dep fires once after wiring and republishes a
 *      late-arriving value through the cell's publish path.
 *   5. Channels are key-namespaced (`<key>/<name>`) so two surfaces that each
 *      own a `state:changed` channel can't collide.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { defineSurface } from "./define";
import {
  type Channel,
  implementSurfaces,
  implementSurfacesOnPublisher,
  inMemoryChannel,
  inMemoryStore,
  type SurfaceHandlers,
} from "./server";

function unary(handlers: SurfaceHandlers, tag: string, payload?: unknown) {
  const handler = handlers[tag];
  if (!handler) throw new Error(`no handler bound at "${tag}"`);
  return handler(payload) as Effect.Effect<unknown>;
}

function surfaceA() {
  return defineSurface({
    cells: {
      state: {
        schema: Schema.Struct({ value: Schema.Number }),
        default: { value: 0 },
      },
    },
    procedures: {
      math: {
        double: {
          input: Schema.Struct({ x: Schema.Number }),
          output: Schema.Struct({ y: Schema.Number }),
        },
      },
    },
  });
}

function surfaceB() {
  return defineSurface({
    cells: {
      state: {
        schema: Schema.Struct({ value: Schema.Number }),
        default: { value: 0 },
      },
    },
  });
}

function buildPair() {
  const a = surfaceA();
  const b = surfaceB();
  return implementSurfaces(
    { a, b },
    {},
    {
      a: {
        cells: { state: { store: inMemoryStore({ value: 0 }) } },
        procedures: {
          math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
        },
      },
      b: { cells: { state: { store: inMemoryStore({ value: 0 }) } } },
    },
  );
}

describe("implementSurfaces tags siblings at surface/<key>/<prim>/<verb>", () => {
  it("binds exactly the composed group's tags for two sibling surfaces", () => {
    const runtime = buildPair();
    const tags = Object.keys(runtime.handlers).sort();
    expect(tags).toEqual(Array.from(runtime.group.requests.keys()).sort());
    expect(tags).toEqual([
      "surface/a/math/double",
      "surface/a/state/get",
      "surface/a/state/set",
      "surface/a/system/clockNow",
      "surface/a/system/identity",
      "surface/a/system/live",
      "surface/b/state/get",
      "surface/b/state/set",
      "surface/b/system/clockNow",
      "surface/b/system/identity",
      "surface/b/system/live",
    ]);
    // No double-prefix.
    expect(tags.some((t) => t.startsWith("surface/surface/"))).toBe(false);
  });

  it("gives each sibling its OWN reserved system members (a bare merge would collide them)", async () => {
    const runtime = buildPair();
    for (const key of ["a", "b"]) {
      expect(
        await Effect.runPromise(
          unary(runtime.handlers, `surface/${key}/system/live`),
        ),
      ).toEqual({});
    }
    await runtime.close();
  });

  it("a real invocation through the sibling's tag validates", async () => {
    const runtime = buildPair();
    const out = await Effect.runPromise(
      unary(runtime.handlers, "surface/a/math/double", { x: 21 }),
    );
    expect(out).toEqual({ y: 42 });
    await runtime.close();
  });

  it("crashes loudly when a sibling has no deps", () => {
    const a = surfaceA();
    const b = surfaceB();
    expect(() =>
      implementSurfaces({ a, b }, {}, {
        a: {
          cells: { state: { store: inMemoryStore({ value: 0 }) } },
          procedures: {
            math: {
              double: ({ input }: { input: { x: number } }) =>
                Effect.succeed({ y: input.x }),
            },
          },
        },
      } as never),
    ).toThrow(/missing deps for surface "b"/);
  });
});

describe("implementSurfaces: connect cell-dep", () => {
  it("fires once after wiring and republishes the late value", async () => {
    const a = surfaceA();
    const store = inMemoryStore({ value: 0 });
    const bus = inMemoryChannel<{ value: number }>();
    const published: Array<{ value: number }> = [];
    bus.consume({
      onEvent: (v) => published.push(v),
      onError: () => {},
    });
    implementSurfacesOnPublisher(
      { a },
      {
        channel: <T>(name: string): Channel<T> =>
          name === "a/state:changed"
            ? (bus as unknown as Channel<T>)
            : inMemoryChannel<T>(),
      },
      {
        a: {
          cells: {
            state: {
              store,
              connect: (cell) =>
                Effect.sync(() => {
                  cell.set({ value: 99 });
                }),
            },
          },
          procedures: {
            math: { double: ({ input }) => Effect.succeed({ y: input.x }) },
          },
        },
      },
    );
    // The connector installs on the constructing stack, so the write has already
    // landed — but let a microtask settle anyway, so this test cannot silently
    // start depending on synchrony it does not mean to assert.
    await Promise.resolve();
    expect(store.get()).toEqual({ value: 99 });
    expect(published).toContainEqual({ value: 99 });
  });
});

describe("implementSurfaces: channels are key-namespaced", () => {
  it("prefixes each surface's channel name with its key", () => {
    const a = surfaceB();
    const b = surfaceB();
    const channel = vi.fn((name: string): Channel<unknown> => {
      void name;
      return inMemoryChannel<unknown>();
    });
    implementSurfacesOnPublisher(
      { a, b },
      { channel: channel as <T>(name: string) => Channel<T> },
      {
        a: { cells: { state: { store: inMemoryStore({ value: 0 }) } } },
        b: { cells: { state: { store: inMemoryStore({ value: 0 }) } } },
      },
    );
    const names = channel.mock.calls.map((c) => c[0]);
    expect(names).toContain("a/state:changed");
    expect(names).toContain("b/state:changed");
    // The un-namespaced name never reaches the base factory.
    expect(names).not.toContain("state:changed");
  });
});
