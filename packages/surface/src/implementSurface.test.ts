/**
 * `implementSurface` returns a supervised {@link SurfaceRuntime} whose `handlers`
 * record is keyed by the member's FULL wire tag — the SAME tag set
 * `defineSurface` minted into `surface.group`. That identity is the whole
 * routing contract on a flat tag namespace: there is no router tree to get the
 * depth of wrong, so what used to be "procedures land at `/surface/<prim>/<verb>`,
 * never the double-prefixed `/surface/surface/…`" is now "the bound handler set
 * IS `group.requests`" (D1).
 *
 * The framework asserts it at construction; these tests pin the OBSERVABLE tag
 * set so a silent re-prefixing is caught here and not at the far end of a wire.
 */

import { Effect, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import {
  type CellStore,
  implementSurface,
  inMemoryStore,
  type SurfaceHandlers,
} from "./server";

function unary(handlers: SurfaceHandlers, tag: string, payload?: unknown) {
  const handler = handlers[tag];
  if (!handler) throw new Error(`no handler bound at "${tag}"`);
  return handler(payload) as Effect.Effect<unknown>;
}

function streaming(handlers: SurfaceHandlers, tag: string, payload?: unknown) {
  const handler = handlers[tag];
  if (!handler) throw new Error(`no handler bound at "${tag}"`);
  return handler(payload) as Stream.Stream<unknown>;
}

function buildRuntime() {
  const surface = defineSurface({
    cells: {
      state: {
        schema: Schema.Struct({ value: Schema.Number }),
        default: { value: 0 },
      },
    },
    collections: {
      items: {
        keySchema: Schema.Number,
        schema: Schema.Struct({ name: Schema.String }),
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
  const store: CellStore<{ value: number }> = inMemoryStore({ value: 0 });
  const items = new Map<number, { name: string }>();
  // The ordinary constructor owns its channel internally — no `channel` dep.
  const runtime = implementSurface(surface, {
    cells: { state: { store } },
    collections: {
      items: {
        readAll: () => items,
        upsert: (k, v) => {
          items.set(k, v);
        },
        remove: (k) => {
          items.delete(k);
        },
      },
    },
    procedures: {
      math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
    },
  });
  return { surface, runtime, store, items };
}

describe("implementSurface binds one handler per wire tag", () => {
  it("the handler key set IS the group's tag set (no re-prefixing, no gaps)", () => {
    const { surface, runtime } = buildRuntime();
    const tags = Object.keys(runtime.handlers).sort();
    expect(tags).toEqual(Array.from(surface.group.requests.keys()).sort());
    // Spelled out, so a change to the tag algebra is visible in the diff and not
    // merely self-consistent with a group that moved the same way.
    expect(tags).toEqual([
      "surface/items/delete",
      "surface/items/get",
      "surface/items/keys",
      "surface/items/upsert",
      "surface/math/double",
      "surface/state/get",
      "surface/state/set",
      "surface/system/clockNow",
      "surface/system/identity",
      "surface/system/live",
    ]);
    // The oRPC-era double-prefix hazard, restated on the tag axis.
    expect(tags.some((t) => t.startsWith("surface/surface/"))).toBe(false);
  });

  it("serves the cell snapshot and a unary procedure through those handlers", async () => {
    const { runtime } = buildRuntime();
    const first = await Effect.runPromise(
      Stream.runCollect(
        Stream.take(streaming(runtime.handlers, "surface/state/get"), 1),
      ),
    );
    expect(first).toEqual([{ value: 0 }]);

    const doubled = await Effect.runPromise(
      unary(runtime.handlers, "surface/math/double", { x: 21 }),
    );
    expect(doubled).toEqual({ y: 42 });
    await runtime.close();
  });

  it("a wire write goes through the store and reaches a live subscriber", async () => {
    const { runtime, store } = buildRuntime();
    const seen: unknown[] = [];
    const fiber = Effect.runFork(
      Stream.runForEach(streaming(runtime.handlers, "surface/state/get"), (v) =>
        Effect.sync(() => {
          seen.push(v);
        }),
      ),
    );
    await new Promise((r) => setTimeout(r, 10));
    await Effect.runPromise(
      unary(runtime.handlers, "surface/state/set", { value: 7 }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get()).toEqual({ value: 7 });
    expect(seen).toEqual([{ value: 0 }, { value: 7 }]);
    await Effect.runPromise(Fiber.interrupt(fiber));
    await runtime.close();
  });

  it("the reserved system members are auto-answered", async () => {
    const { runtime } = buildRuntime();
    expect(
      await Effect.runPromise(unary(runtime.handlers, "surface/system/live")),
    ).toEqual({});
    const identity = (await Effect.runPromise(
      unary(runtime.handlers, "surface/system/identity"),
    )) as { kind: string };
    expect(identity.kind).toBe("anonymous");
    const clock = (await Effect.runPromise(
      unary(runtime.handlers, "surface/system/clockNow"),
    )) as { epochMs: number };
    expect(typeof clock.epochMs).toBe("number");
    await runtime.close();
  });

  it("crashes loudly when a declared member has no dep", () => {
    const surface = defineSurface({
      cells: { state: { schema: Schema.Number, default: 0 } },
    });
    expect(() => implementSurface(surface, {})).toThrow(
      /missing deps for cell "state"/,
    );
  });
});
