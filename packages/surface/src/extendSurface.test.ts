/**
 * `extendSurface` — compose a parent-LOCAL runtime onto a RE-SERVED one (SR5).
 *
 * The three properties the plan names, restated for a FLAT tag namespace:
 *
 *   - the composed runtime serves EVERY base + extension member at the SAME wire
 *     tag it had standalone. Under oRPC this needed both router fragments to be
 *     re-adapted through `implement(combined).router({...})` so they picked up
 *     the combined contract's matcher meta, and the pin was a matcher-tree
 *     assertion. With tags there is no matcher to re-adapt — a tag carries its
 *     own route — so the pin is ROUTE-SET IDENTITY: the merged handler key set
 *     equals `combined.group.requests`, and it equals the union of the two
 *     inputs' tags;
 *   - supervision routes through `superviseTerminalSource`: the base is the
 *     terminal driver (its end resolves the composite), `close` releases both;
 *   - a member-name collision between base and extension fails loud.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import {
  extendSurface,
  implementSurface,
  inMemoryCollection,
  inMemoryStore,
  type ServedSurface,
  type SurfaceHandlers,
} from "./server";

function streaming(handlers: SurfaceHandlers, tag: string, payload?: unknown) {
  const handler = handlers[tag];
  if (!handler) throw new Error(`no handler bound at "${tag}"`);
  return handler(payload) as Stream.Stream<unknown>;
}

async function firstFrame(stream: Stream.Stream<unknown>): Promise<unknown> {
  const frames = await Effect.runPromise(
    Stream.runCollect(Stream.take(stream, 1)),
  );
  return frames[0];
}

// A re-served BASE: a status cell + a keyed collection (the mirror's shape).
const baseSurface = defineSurface({
  cells: { status: { schema: Schema.String, default: "" } },
  collections: { items: { keySchema: Schema.String, schema: Schema.Number } },
});
// A parent-LOCAL extension: a retention cell (drishti's `metricHistory` shape).
const extSurface = defineSurface({
  cells: {
    history: {
      schema: Schema.Array(Schema.Number),
      default: [] as readonly number[],
    },
  },
});

function buildBase() {
  return implementSurface(baseSurface, {
    cells: { status: { store: inMemoryStore("live") } },
    // The additive in-memory collection this PR extracted for exactly this shape.
    collections: { items: inMemoryCollection<string, number>() },
  });
}

function buildExt() {
  return implementSurface(extSurface, {
    cells: {
      history: { store: inMemoryStore<readonly number[]>([1, 2, 3]) },
    },
  });
}

describe("extendSurface", () => {
  it("route-set identity: the merged handlers ARE the combined group's tags, flat and un-re-prefixed", () => {
    const baseRt = buildBase();
    const extRt = buildExt();
    const composed = extendSurface(
      { surface: baseSurface, ...baseRt },
      { surface: extSurface, ...extRt },
    );

    const tags = Object.keys(composed.handlers).sort();
    // The framework's own construction-time assertion, restated as an
    // observable: every advertised tag has exactly one handler.
    expect(tags).toEqual(Array.from(composed.group.requests.keys()).sort());
    expect(tags).toEqual([
      "surface/history/get",
      "surface/history/set",
      "surface/items/delete",
      "surface/items/get",
      "surface/items/keys",
      "surface/items/upsert",
      "surface/status/get",
      "surface/status/set",
      "surface/system/clockNow",
      "surface/system/identity",
      "surface/system/live",
    ]);
    // …and it is exactly the UNION of the two inputs' tags: every base member
    // and every extension member routes at the tag it had standalone.
    const union = new Set([
      ...Object.keys(baseRt.handlers),
      ...Object.keys(extRt.handlers),
    ]);
    expect(tags).toEqual(Array.from(union).sort());
    expect(tags.some((t) => t.startsWith("surface/surface/"))).toBe(false);
  });

  it("serves a base member AND an extension member through the one composed handler record", async () => {
    const composed = extendSurface(
      { surface: baseSurface, ...buildBase() },
      { surface: extSurface, ...buildExt() },
    );
    // The base's status cell (snapshot-then-deltas — take the first frame).
    expect(
      await firstFrame(streaming(composed.handlers, "surface/status/get")),
    ).toBe("live");
    // The local extension's history cell, served flat beside the base.
    expect(
      await firstFrame(streaming(composed.handlers, "surface/history/get")),
    ).toEqual([1, 2, 3]);
    await composed.close();
  });

  it("resolves the reserved system tags BASE-authoritative (they are the one legitimate overlap)", () => {
    const baseRt = buildBase();
    const extRt = buildExt();
    const composed = extendSurface(
      { surface: baseSurface, ...baseRt },
      { surface: extSurface, ...extRt },
    );
    for (const verb of ["live", "identity", "clockNow"]) {
      const tag = `surface/system/${verb}`;
      expect(composed.handlers[tag]).toBe(baseRt.handlers[tag]);
      expect(composed.handlers[tag]).not.toBe(extRt.handlers[tag]);
    }
  });

  it("supervision: the base's terminal end resolves the composite done", async () => {
    let resolveTerminal!: () => void;
    const terminalDone = new Promise<void>((r) => {
      resolveTerminal = r;
    });
    const extRt = buildExt();
    const base: ServedSurface<never> = {
      surface: baseSurface as never,
      handlers: buildBase().handlers,
      done: terminalDone,
      close: async () => resolveTerminal(),
    };
    const composed = extendSurface(base, { surface: extSurface, ...extRt });

    let settled = false;
    void composed.done.then(() => {
      settled = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false);

    resolveTerminal(); // the mirror's remote session was destroyed
    await expect(composed.done).resolves.toBeUndefined();
  });

  it("supervision: close() releases BOTH the base and the local extension", async () => {
    let baseClosed = 0;
    let resolveTerminal!: () => void;
    const terminalDone = new Promise<void>((r) => {
      resolveTerminal = r;
    });
    const extRt = buildExt();
    let extClosed = 0;
    const base: ServedSurface<never> = {
      surface: baseSurface as never,
      handlers: buildBase().handlers,
      done: terminalDone,
      close: async () => {
        baseClosed += 1;
        resolveTerminal();
      },
    };
    const ext: ServedSurface<never> = {
      surface: extSurface as never,
      handlers: extRt.handlers,
      done: extRt.done,
      close: async () => {
        extClosed += 1;
        await extRt.close();
      },
    };
    const composed = extendSurface(base, ext);
    await composed.close();
    expect(baseClosed).toBe(1);
    expect(extClosed).toBe(1);
    await composed.close(); // idempotent
    expect(baseClosed).toBe(1);
    expect(extClosed).toBe(1);
  });

  it("fails loud on a member-name collision between base and extension", () => {
    const clashing = defineSurface({
      // Same `status` cell name as the base — a composed surface can't have two.
      cells: { status: { schema: Schema.String, default: "" } },
    });
    expect(() =>
      extendSurface(
        { surface: baseSurface, ...buildBase() },
        {
          surface: clashing,
          ...implementSurface(clashing, {
            cells: { status: { store: inMemoryStore("") } },
          }),
        },
      ),
    ).toThrow(/both serve member "status"/);
  });

  it("preserves an extension's app-owned system verb (its tag is its own)", async () => {
    // `defineSurface` permits app-owned `system.*` verbs beside the reserved
    // live/identity/clockNow. On a FLAT tag namespace `surface/system/echo` is a
    // different tag from `surface/system/live`, so the base-authoritative rule
    // for the reserved three cannot drop it — no per-verb deep-merge needed.
    const extWithSystem = defineSurface({
      cells: {
        history: {
          schema: Schema.Array(Schema.Number),
          default: [] as readonly number[],
        },
      },
      procedures: {
        system: {
          echo: {
            input: Schema.Struct({ x: Schema.Number }),
            output: Schema.Struct({ x: Schema.Number }),
          },
        },
      },
    });
    const composed = extendSurface(
      { surface: baseSurface, ...buildBase() },
      {
        surface: extWithSystem,
        ...implementSurface(extWithSystem, {
          cells: {
            history: { store: inMemoryStore<readonly number[]>([]) },
          },
          procedures: {
            system: { echo: ({ input }) => Effect.succeed(input) },
          },
        }),
      },
    );
    const tags = Object.keys(composed.handlers);
    expect(tags).toContain("surface/system/echo");
    expect(tags).toContain("surface/system/live");
    const echoed = await Effect.runPromise(
      composed.handlers["surface/system/echo"]?.({
        x: 5,
      }) as Effect.Effect<unknown>,
    );
    expect(echoed).toEqual({ x: 5 });
    await composed.close();
  });

  it("materializes every kind so an absent kind reads as an object, not undefined", () => {
    // ComposedSurfaceSpec types every kind present; mergeSurfaceSpecs materializes
    // them so `composed.surface.spec.<kind>` is an object even when both sides omit
    // it — the descriptor type and value agree.
    const composed = extendSurface(
      { surface: baseSurface, ...buildBase() },
      { surface: extSurface, ...buildExt() },
    );
    // extSurface declares no streams/events/procedures; the merged spec still has them.
    expect(composed.surface.spec.streams).toEqual({});
    expect(composed.surface.spec.events).toEqual({});
    expect(composed.surface.spec.procedures).toEqual({});
  });

  it("fails loud on a CROSS-KIND name collision (base cell vs ext procedure namespace)", () => {
    // The flat wire namespace is per-NAME across all kinds: a base cell `status` and
    // an ext procedure namespace `status` have disjoint verbs, so they escape the
    // per-kind spec guard AND defineSurface's per-(name,verb) claim — the guarded
    // merge is what stops one side from silently dropping the other.
    const clashingProc = defineSurface({
      procedures: {
        status: { refresh: { output: Schema.Struct({ ok: Schema.Boolean }) } },
      },
    });
    expect(() =>
      extendSurface(
        { surface: baseSurface, ...buildBase() },
        {
          surface: clashingProc,
          ...implementSurface(clashingProc, {
            procedures: {
              status: { refresh: () => Effect.succeed({ ok: true }) },
            },
          }),
        },
      ),
    ).toThrow(/both serve member "status"/);
  });
});
