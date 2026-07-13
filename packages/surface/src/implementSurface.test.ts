/**
 * `implementSurface` returns a supervised {@link SurfaceRuntime} whose `router`
 * is the FINAL top-level oRPC router — NOT a fragment. A consumer hands
 * `runtime.router` straight to `RPCHandler` / `serveOverStdio` / `directLink`,
 * or spreads its `.surface` beside its own raw namespaces. No consumer
 * re-finalizes the surface via `implement(contract).router({...})` anymore.
 *
 * This pins the router depth: procedures land at `/surface/<prim>/<verb>`, never
 * the old bare-fragment double-prefix (`/surface/surface/<prim>/<verb>`) that
 * 404'd every client request.
 */

import { StandardRPCMatcher } from "@orpc/server/standard";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { type CellStore, implementSurface, inMemoryStore } from "./server";

function buildRuntime() {
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
  });
  return { surface, runtime };
}

describe("implementSurface returns a final top-level router", () => {
  it("runtime.router lands procedures at the right depth (no double prefix)", () => {
    const { runtime } = buildRuntime();
    const matcher = new StandardRPCMatcher();
    // biome-ignore lint/suspicious/noExplicitAny: matcher.init expects a Router shape; runtime.router satisfies the runtime contract.
    matcher.init(runtime.router as any);
    const paths = Object.keys(
      (matcher as unknown as { tree: Record<string, unknown> }).tree,
    );
    expect(paths).toContain("/surface/state/get");
    expect(paths).toContain("/surface/items/keys");
    expect(paths).not.toContain("/surface/surface/state/get");
    expect(paths).not.toContain("/surface/surface/items/keys");
  });
});
