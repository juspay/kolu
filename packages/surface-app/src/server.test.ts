/**
 * `buildInfoServer` — the buildInfo cell's server fragment. The regression
 * surface this test guards: the seed must be a schema-valid `T` *before* an
 * async axis settles (so the first wire snapshot never carries a half-shape),
 * the async patch must fold in and reach subscribers through `connect`, and a
 * rejected async source must surface via `onError` instead of being swallowed.
 */

import { defineSurface } from "@kolu/surface/define";
import { inMemoryChannel, inMemoryStore } from "@kolu/surface/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildInfoServer,
  implementSurfaceApp,
  surfaceAppServer,
} from "./server";
import { composeSurfaces, surfaceAppSurface } from "./surface";
import type { BuildInfo } from "./surface";

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

describe("implementSurfaceApp — one-call server composition", () => {
  // A tiny app surface: the surface-app fragment (buildInfo cell + the
  // `surfaceApp.info` probe) composed with the app's OWN `mine` cell.
  const surface = defineSurface(
    composeSurfaces(surfaceAppSurface, {
      cells: {
        mine: { schema: z.object({ n: z.number() }), default: { n: 0 } },
      },
    }),
  );

  /** Invoke a wired surface procedure the way the runtime does — through the
   *  decorated oRPC handler the router fragment exposes. (`@orpc/server`'s
   *  `call`/`createRouterClient` aren't reachable from this package, so we drive
   *  the procedure's `~orpc.handler` directly; it's the same fn the wire calls.) */
  function callProcedure(
    router: unknown,
    ns: string,
    verb: string,
    input: unknown,
  ): Promise<unknown> {
    // biome-ignore lint/suspicious/noExplicitAny: reaching the decorated procedure's runtime handler.
    const proc = (router as any).surface[ns][verb];
    return proc["~orpc"].handler({ input, context: {} });
  }

  function build() {
    return implementSurfaceApp(
      surface,
      surfaceAppServer({ commit: "abc1234", processId: "pid-1" }),
      {
        channel: <T>(_name: string) => inMemoryChannel<T>(),
        // The app passes ONLY its own cell — buildInfo is the fragment's.
        cells: { mine: { store: inMemoryStore({ n: 7 }) } },
      },
    );
  }

  it("returns { router, ctx }", () => {
    const result = build();
    expect(result.router).toBeDefined();
    expect(result.ctx).toBeDefined();
  });

  it("wires the fragment's buildInfo cell carrying the commit", () => {
    const { ctx } = build();
    expect(ctx.cells.buildInfo).toBeDefined();
    expect(ctx.cells.buildInfo.get()).toEqual({ commit: "abc1234" });
  });

  it("wires the app's own `mine` cell alongside the fragment", () => {
    const { ctx } = build();
    expect(ctx.cells.mine).toBeDefined();
    expect(ctx.cells.mine.get()).toEqual({ n: 7 });
  });

  it("makes the surfaceApp.info probe reachable, returning { processId }", async () => {
    const { router } = build();
    const out = await callProcedure(router, "surfaceApp", "info", {});
    expect(out).toEqual({ processId: "pid-1" });
  });
});
