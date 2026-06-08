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

import { implementSurfaces, inMemoryChannelByName } from "@kolu/surface/server";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  NOTIFICATION_SW_SOURCE,
  STALE_PROCESS_CLOSE_CODE,
  SW_SOURCE,
} from "./index";
import {
  buildInfoServer,
  gateStaleSocket,
  type GateableSocket,
  installFreshStatic,
  installSurfaceApp,
  surfaceAppServer,
} from "./server";
import type { BuildInfo } from "./surface";
import { surfaceAppSurface } from "./surface";

describe("installFreshStatic — the /sw.js route", () => {
  it("serves the self-destructing retirement worker by default", async () => {
    const app = new Hono();
    installFreshStatic(app, { root: "/nonexistent" });
    const res = await app.request("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(await res.text()).toBe(SW_SOURCE);
  });

  it("serves the fetch-less notification worker with serviceWorker: 'notify'", async () => {
    const app = new Hono();
    installFreshStatic(app, { root: "/nonexistent", serviceWorker: "notify" });
    const res = await app.request("/sw.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(NOTIFICATION_SW_SOURCE);
  });

  it("serves /sw.js no-cache so the browser's update check always sees a fresh worker", async () => {
    const app = new Hono();
    installFreshStatic(app, { root: "/nonexistent", serviceWorker: "notify" });
    const res = await app.request("/sw.js");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
  });
});

describe("installSurfaceApp — forwards the serviceWorker option to /sw.js", () => {
  it("default forwards the retirement worker", async () => {
    const app = new Hono();
    installSurfaceApp(app, { clientDist: "/nonexistent" });
    expect(await (await app.request("/sw.js")).text()).toBe(SW_SOURCE);
  });

  it("forwards serviceWorker: 'notify' to the notification worker", async () => {
    const app = new Hono();
    installSurfaceApp(app, {
      clientDist: "/nonexistent",
      serviceWorker: "notify",
    });
    expect(await (await app.request("/sw.js")).text()).toBe(
      NOTIFICATION_SW_SOURCE,
    );
  });
});

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
    // …and the SAME id is exposed directly, so a stale-tab gate compares against
    // the value the probe reports rather than minting a second one.
    expect(server.processId).toBe("pid-1");
  });

  it("exposes the minted processId (matching what the probe reports) when none is injected", async () => {
    const server = surfaceAppServer({ commit: "abc1234" });
    expect(typeof server.processId).toBe("string");
    expect(server.processId.length).toBeGreaterThan(0);
    // Single-sourced: the exposed id IS the one identity.info reports.
    expect(await server.procedures.identity.info()).toEqual({
      processId: server.processId,
    });
  });

  it("serves surface-app as a SIBLING surface under its key, fires buildInfo connect", async () => {
    const server = surfaceAppServer({ commit: "abc1234", processId: "pid-1" });
    // Spy on the cell entry's connect to prove the runtime fires it for us.
    const connect = vi.spyOn(server.cells.buildInfo, "connect");
    const { router, ctx } = implementSurfaces(
      { surfaceApp: surfaceAppSurface },
      { channel: inMemoryChannelByName() },
      { surfaceApp: server },
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
      { a: surfaceAppSurface, b: surfaceAppSurface },
      { channel: inMemoryChannelByName() },
      {
        a: surfaceAppServer({ commit: "aaa1111", processId: "pa" }),
        b: surfaceAppServer({ commit: "bbb2222", processId: "pb" }),
      },
    );
    expect(ctx.a?.cells.buildInfo?.get()).toEqual({ commit: "aaa1111" });
    expect(ctx.b?.cells.buildInfo?.get()).toEqual({ commit: "bbb2222" });
  });
});

/** A server socket reduced to what the gate touches: the `error` listener we
 *  capture, and the `close(code, reason)` we record. */
function fakeGateable() {
  let errorListener: ((err: Error) => void) | undefined;
  const closes: { code: number; reason?: string }[] = [];
  const ws: GateableSocket = {
    on: (_event, listener) => {
      errorListener = listener;
      return ws;
    },
    close: (code, reason) => {
      closes.push({ code, reason });
    },
  };
  return { ws, closes, fireError: (err: Error) => errorListener?.(err) };
}

const upgradeUrl = (pid?: string) =>
  new URL(`ws://host/rpc/ws${pid === undefined ? "" : `?pid=${pid}`}`);

describe("gateStaleSocket — the WS-upgrade handshake gate", () => {
  it("lets a matching processId through (returns false, no close)", () => {
    const t = fakeGateable();
    expect(gateStaleSocket(t.ws, upgradeUrl("live-1"), "live-1")).toBe(false);
    expect(t.closes).toEqual([]);
  });

  it("lets the first-ever connect (absent pid) through", () => {
    const t = fakeGateable();
    expect(gateStaleSocket(t.ws, upgradeUrl(), "live-1")).toBe(false);
    expect(t.closes).toEqual([]);
  });

  it("rejects a stale tab: closes with STALE_PROCESS_CLOSE_CODE and returns true", () => {
    const t = fakeGateable();
    const onReject = vi.fn();
    expect(
      gateStaleSocket(t.ws, upgradeUrl("dead-0"), "live-1", { onReject }),
    ).toBe(true);
    expect(t.closes).toEqual([
      { code: STALE_PROCESS_CLOSE_CODE, reason: "stale server process" },
    ]);
    // onReject sees the non-null claimed id it rejected.
    expect(onReject).toHaveBeenCalledWith("dead-0");
  });

  it("installs the error listener BEFORE deciding — even on the reject path", () => {
    const t = fakeGateable();
    const onError = vi.fn();
    // A stale socket that errors after we close it must not crash the process:
    // the listener is wired before the close/return.
    gateStaleSocket(t.ws, upgradeUrl("dead-0"), "live-1", { onError });
    t.fireError(new Error("post-close peer error"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "post-close peer error" }),
    );
  });

  it("installs a LOUD (console.error) error listener by default (no onError)", () => {
    const t = fakeGateable();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    gateStaleSocket(t.ws, upgradeUrl("live-1"), "live-1");
    // The default listener exists, doesn't throw (an unhandled `error` would
    // otherwise be fatal), AND logs loudly rather than swallowing — an accepted
    // socket's transport error must not vanish silently.
    expect(() => t.fireError(new Error("boom"))).not.toThrow();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("gateStaleSocket"),
      expect.objectContaining({ message: "boom" }),
    );
    spy.mockRestore();
  });
});
