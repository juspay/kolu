/**
 * `implementSurface` returns a router *fragment* (`{ surface: ... }`) —
 * NOT a top-level router. Consumers must wrap it via
 * `implement(contract).router({...fragment})` (or spread it alongside
 * other namespaces, the way Kolu's main server does) before handing it
 * to `RPCHandler` / `StandardRPCHandler` / `serveOverStdio`.
 *
 * Passing the fragment straight to a handler produces a double-prefix
 * in the matcher tree (`/surface/surface/processes/keys` instead of
 * `/surface/processes/keys`), and every client request 404s.
 *
 * This file pins both behaviours:
 *   1. The bare fragment double-prefixes (so anyone who refactors the
 *      framework to "fix" implementSurface notices the breakage).
 *   2. The wrapped fragment matches at the right depth.
 */

import { implement } from "@orpc/server";
import { StandardRPCMatcher } from "@orpc/server/standard";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import {
  type CellStore,
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryStore,
} from "./server";

function buildFragment() {
  const surface = defineSurface({
    cells: {
      state: { schema: z.object({ value: z.number() }), default: { value: 0 } },
    },
    collections: {
      items: { keySchema: z.number(), schema: z.object({ name: z.string() }) },
    },
  });
  const store: CellStore<{ value: number }> = inMemoryStore({ value: 0 });
  const items = new Map<number, { name: string }>();
  const fragment = implementSurface(surface, {
    channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
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
  });
  return { surface, fragment };
}

describe("implementSurface router-wrapping requirement", () => {
  it("bare fragment.router has a double-prefix matcher tree (DOCUMENTS the gotcha)", () => {
    const { fragment } = buildFragment();
    const matcher = new StandardRPCMatcher();
    matcher.init(
      // biome-ignore lint/suspicious/noExplicitAny: matcher accepts router-shaped objects; we're exercising the bare-fragment path.
      fragment.router as any,
    );
    const paths = Object.keys(
      (matcher as unknown as { tree: Record<string, unknown> }).tree,
    );
    expect(paths).toContain("/surface/surface/state/get");
    expect(paths).toContain("/surface/surface/items/keys");
  });

  it("`implement(contract).router({...fragment.router})` lands at the right depth", () => {
    const { surface, fragment } = buildFragment();
    const wrapped = implement(surface.contract).router({
      ...fragment.router,
      // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's RouterImplementer input type; the runtime shape is a valid router. Same as-any cast Kolu's server.ts uses.
    } as any);
    const matcher = new StandardRPCMatcher();
    // biome-ignore lint/suspicious/noExplicitAny: matcher.init expects a Router shape; the wrapped value satisfies the runtime contract.
    matcher.init(wrapped as any);
    const paths = Object.keys(
      (matcher as unknown as { tree: Record<string, unknown> }).tree,
    );
    expect(paths).toContain("/surface/state/get");
    expect(paths).toContain("/surface/items/keys");
    expect(paths).not.toContain("/surface/surface/state/get");
  });
});
