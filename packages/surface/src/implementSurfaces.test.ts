/**
 * `implementSurfaces` serves a keyed MAP of independent surfaces as SIBLINGS
 * multiplexed over one transport — each namespaced by its key, NOT merged.
 *
 * This file pins:
 *   1. Matcher paths land at `/surface/<key>/<prim>/<verb>` for two sibling
 *      surfaces (no double-prefix — the inner contract is re-keyed, not
 *      raw-nested).
 *   2. A real `call()` through `router.surface.<key>.<ns>.<verb>` validates.
 *   3. The `connect` cell-dep fires once after wiring and republishes a
 *      late-arriving value through the cell's publish path.
 *   4. Channels are key-namespaced (`<key>/<name>`) so two surfaces that each
 *      own a `state:changed` channel can't collide.
 */

import { call, implement } from "@orpc/server";
import { StandardRPCMatcher } from "@orpc/server/standard";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import {
  type Channel,
  composeSurfaceContracts,
  implementSurfaces,
  inMemoryChannel,
  inMemoryStore,
} from "./server";

function surfaceA() {
  return defineSurface({
    cells: {
      state: { schema: z.object({ value: z.number() }), default: { value: 0 } },
    },
    procedures: {
      math: {
        double: {
          input: z.object({ x: z.number() }),
          output: z.object({ y: z.number() }),
        },
      },
    },
  });
}

function surfaceB() {
  return defineSurface({
    cells: {
      state: { schema: z.object({ value: z.number() }), default: { value: 0 } },
    },
  });
}

describe("implementSurfaces routes siblings at /surface/<key>/<prim>/<verb>", () => {
  it("matcher tree lands at the right depth for two sibling surfaces", () => {
    const a = surfaceA();
    const b = surfaceB();
    const surfaces = { a, b };
    const { router } = implementSurfaces(
      surfaces,
      { channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>() },
      {
        a: {
          cells: { state: { store: inMemoryStore({ value: 0 }) } },
          procedures: {
            math: {
              double: async ({ input }: { input: unknown }) => ({
                y: (input as { x: number }).x * 2,
              }),
            },
          },
        },
        b: { cells: { state: { store: inMemoryStore({ value: 0 }) } } },
      },
    );
    // Same wrapping requirement as `implementSurface`: the bare fragment
    // double-prefixes; `implement(contract).router({...fragment})` lands it
    // at the right depth. The contract is `composeSurfaceContracts(surfaces)`.
    const contract = composeSurfaceContracts(surfaces);
    const wrapped = implement(contract).router({
      ...router,
      // biome-ignore lint/suspicious/noExplicitAny: implementSurfaces' Lazy<Router> spread isn't accepted by oRPC's RouterImplementer input type; the runtime shape is a valid router.
    } as any);
    const matcher = new StandardRPCMatcher();
    // biome-ignore lint/suspicious/noExplicitAny: matcher.init expects a Router; the wrapped runtime shape satisfies it.
    matcher.init(wrapped as any);
    const paths = Object.keys(
      (matcher as unknown as { tree: Record<string, unknown> }).tree,
    );
    expect(paths).toContain("/surface/a/state/get");
    expect(paths).toContain("/surface/b/state/get");
    expect(paths).toContain("/surface/a/math/double");
    // No double-prefix.
    expect(paths).not.toContain("/surface/surface/a/state/get");
  });

  it("a real call() through router.surface.<key>.<ns>.<verb> validates", async () => {
    const a = surfaceA();
    const b = surfaceB();
    const { router } = implementSurfaces(
      { a, b },
      { channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>() },
      {
        a: {
          cells: { state: { store: inMemoryStore({ value: 0 }) } },
          procedures: {
            math: {
              double: async ({ input }: { input: unknown }) => ({
                y: (input as { x: number }).x * 2,
              }),
            },
          },
        },
        b: { cells: { state: { store: inMemoryStore({ value: 0 }) } } },
      },
    );
    const out = await call(
      // biome-ignore lint/suspicious/noExplicitAny: router walk-by-string to the procedure ref.
      (router as any).surface.a.math.double,
      { x: 21 },
    );
    expect(out).toEqual({ y: 42 });
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
    implementSurfaces(
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
              connect: async (cell) => {
                cell.set({ value: 99 });
              },
            },
          },
          procedures: {
            math: {
              double: async ({ input }: { input: unknown }) => ({
                y: (input as { x: number }).x,
              }),
            },
          },
        },
      },
    );
    // `connect` is async; let the microtask settle.
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
    implementSurfaces(
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
