/**
 * `buildInfoServer` — the buildInfo cell's server fragment. The regression
 * surface this test guards: the seed must be a schema-valid `T` *before* an
 * async axis settles (so the first wire snapshot never carries a half-shape),
 * the async patch must fold in and reach subscribers through `connect`, and a
 * rejected async source must surface via `onError` instead of being swallowed.
 *
 * `surfaceAppServer` — the deps bundle a consumer drops into an
 * `implementSurfaces` entry: surface-app is served as a SIBLING surface, not
 * merged into the app surface.
 */

import type { ImplementSurfaceDeps } from "@kolu/surface/server";
import { implementSurfaces, inMemoryChannelByName } from "@kolu/surface/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildInfoServer, surfaceAppServer } from "./server";
import type { BuildInfo } from "./surface";
import { surfaceAppSurface } from "./surface";

interface ExtBuildInfo extends BuildInfo {
  bootId: string;
}

describe("buildInfoServer — sync sources", () => {
  it("stamps the resolved commit when none is in the value", () => {
    const frag = buildInfoServer({ commit: "abc1234" });
    expect(frag.buildInfo.current()).toEqual({ commit: "abc1234" });
  });

  it("a plain value is the seed, with the explicit commit winning", () => {
    const frag = buildInfoServer<ExtBuildInfo>({
      commit: "abc1234",
      buildInfo: { commit: "ignored", bootId: "boot-1" },
    });
    expect(frag.buildInfo.current()).toEqual({
      commit: "abc1234",
      bootId: "boot-1",
    });
  });

  it("connect on a sync source republishes the (deduped) seed", async () => {
    const frag = buildInfoServer({ commit: "abc1234" });
    const set = vi.fn();
    await frag.buildInfo.connect({ set });
    expect(set).toHaveBeenCalledWith({ commit: "abc1234" });
  });
});

describe("buildInfoServer — async sources", () => {
  it("seeds the full schema-valid default before the async axis settles", async () => {
    let resolve!: (v: Partial<ExtBuildInfo>) => void;
    const frag = buildInfoServer<ExtBuildInfo>({
      commit: "abc1234",
      default: { commit: "", bootId: "" },
      buildInfo: () => new Promise<Partial<ExtBuildInfo>>((r) => (resolve = r)),
    });
    // Pre-settle: the snapshot is a full ExtBuildInfo, never missing `bootId`.
    expect(frag.buildInfo.current()).toEqual({ commit: "abc1234", bootId: "" });
    resolve({ bootId: "boot-9" });
    await frag.buildInfo.ready;
    expect(frag.buildInfo.current()).toEqual({
      commit: "abc1234",
      bootId: "boot-9",
    });
  });

  it("connect republishes the folded value AFTER the async source settles", async () => {
    const frag = buildInfoServer<ExtBuildInfo>({
      commit: "abc1234",
      default: { commit: "", bootId: "" },
      buildInfo: async () => ({ bootId: "boot-late" }),
    });
    const set = vi.fn();
    await frag.buildInfo.connect({ set });
    expect(set).toHaveBeenCalledWith({
      commit: "abc1234",
      bootId: "boot-late",
    });
  });

  it("surfaces a rejected async source via onError and keeps the seed", async () => {
    const onError = vi.fn();
    const boom = new Error("link down");
    const frag = buildInfoServer<ExtBuildInfo>({
      commit: "abc1234",
      default: { commit: "", bootId: "" },
      buildInfo: async () => {
        throw boom;
      },
      onError,
    });
    await frag.buildInfo.ready;
    expect(onError).toHaveBeenCalledWith(boom);
    // The skew axis still works; the extra axis stays at its seeded default.
    expect(frag.buildInfo.current()).toEqual({ commit: "abc1234", bootId: "" });
  });
});

describe("buildInfoServer — equals (cell dedup)", () => {
  it("defaults to JSON.stringify identity", () => {
    const frag = buildInfoServer({ commit: "abc1234" });
    expect(frag.buildInfo.equals({ commit: "x" }, { commit: "x" })).toBe(true);
    expect(frag.buildInfo.equals({ commit: "x" }, { commit: "y" })).toBe(false);
  });
});

describe("surfaceAppServer — the implementSurfaces deps bundle", () => {
  it("bundles the buildInfo cell impl (carrying connect) + the identity.info probe impl", async () => {
    const server = surfaceAppServer({ commit: "abc1234", processId: "pid-1" });
    // The buildInfo cell entry carries `.connect` — the surface runtime's
    // cell-dep the core fires automatically (no app-visible connect).
    expect(typeof server.cells.buildInfo.connect).toBe("function");
    expect(server.cells.buildInfo.current()).toEqual({ commit: "abc1234" });
    // The probe impl sits under the `identity` namespace.
    expect(await server.procedures.identity.info()).toEqual({
      processId: "pid-1",
    });
  });

  it("serves surface-app as a SIBLING surface under its key, fires buildInfo connect", async () => {
    const server = surfaceAppServer({ commit: "abc1234", processId: "pid-1" });
    // Spy on the cell entry's connect to prove the runtime fires it for us.
    const connect = vi.spyOn(server.cells.buildInfo, "connect");
    const { router, ctx } = implementSurfaces(
      { channel: inMemoryChannelByName() },
      {
        surfaceApp: { surface: surfaceAppSurface, deps: asDeps(server) },
      },
    );

    // The per-key ctx exposes the buildInfo cell carrying the commit.
    expect(ctx.surfaceApp?.cells.buildInfo?.get()).toEqual({
      commit: "abc1234",
    });

    // The runtime fires the cell-dep connect automatically — no app-visible call.
    await Promise.resolve();
    expect(connect).toHaveBeenCalledTimes(1);

    // The probe routes at surface.surfaceApp.identity.info (the key namespaces
    // the sibling; the probe is in the surface's own `identity` namespace).
    // biome-ignore lint/suspicious/noExplicitAny: reaching the decorated procedure's runtime handler.
    const proc = (router as any).surface.surfaceApp.identity.info;
    const out = await proc["~orpc"].handler({ input: {}, context: {} });
    expect(out).toEqual({ processId: "pid-1" });
  });

  it("serves two surfaces whose buildInfo channels don't collide", () => {
    // A second standalone surface-app sibling (e.g. drishti's admin vs. host)
    // — each gets a key-namespaced `buildInfo:changed` channel, so the two
    // can't collide on the wire. We assert both ctxs wire independently.
    const { ctx } = implementSurfaces(
      { channel: inMemoryChannelByName() },
      {
        a: {
          surface: surfaceAppSurface,
          deps: asDeps(
            surfaceAppServer({ commit: "aaa1111", processId: "pa" }),
          ),
        },
        b: {
          surface: surfaceAppSurface,
          deps: asDeps(
            surfaceAppServer({ commit: "bbb2222", processId: "pb" }),
          ),
        },
      },
    );
    expect(ctx.a?.cells.buildInfo?.get()).toEqual({ commit: "aaa1111" });
    expect(ctx.b?.cells.buildInfo?.get()).toEqual({ commit: "bbb2222" });
  });
});

/** Drop the typed `surfaceAppServer` bundle into an `implementSurfaces` entry's
 *  `deps`. The entry deps type is `ImplementSurfaceDeps<any>` (the map is
 *  heterogeneous), whose cell-value members (`equals`, `connect`) are typed
 *  against `unknown` and so reject any concretely-typed cell entry contravariantly
 *  — the same reason `@kolu/surface`'s own `implementSurfaces` tests cast at the
 *  router/handler boundary. The runtime shape is exactly right; only the variance
 *  is unsatisfiable, so we assert it here. */
function asDeps(
  server: ReturnType<typeof surfaceAppServer>,
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous-map entry deps are intentionally `any`-spec'd.
): Omit<ImplementSurfaceDeps<any>, "channel"> {
  // biome-ignore lint/suspicious/noExplicitAny: variance-only cast; the runtime structure is sound.
  return server as any;
}
