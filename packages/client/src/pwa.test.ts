import type { ServerLifecycleEvent } from "./rpc/rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** pwa.ts reads `lifecycle()` and `serverInfo()` from `./rpc/rpc`, which opens a
 *  live PartySocket at module-eval and isn't importable under Vitest. Mock it to
 *  those two accessors, driven by `h` so a test can simulate a server restart or
 *  a client/server commit mismatch. */
const h = vi.hoisted(() => ({
  lifecycleKind: "connected" as ServerLifecycleEvent["kind"],
  serverInfo: undefined as { commit?: string } | undefined,
}));
vi.mock("./rpc/rpc", () => ({
  lifecycle: () => ({ kind: h.lifecycleKind }),
  serverInfo: () => h.serverInfo,
}));

/** pwa.ts reads `navigator`/`caches` (at module-eval and retirement time) and
 *  `__KOLU_COMMIT__` (a build-time define); re-import per test, after any global
 *  stub, so each case starts clean. */
function loadPwa() {
  return import("./pwa");
}

/** Flush the unawaited `.then()` chains `retireServiceWorker` fires. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  h.lifecycleKind = "connected";
  h.serverInfo = undefined;
  // The node test env has a `navigator` without `serviceWorker` (matches plain
  // HTTP/LAN); individual tests stub one in to simulate a secure context.
  vi.stubGlobal("__KOLU_COMMIT__", "clientsha");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updateReady — when to offer a reload (no service worker)", () => {
  it("is false when connected and the client matches the server", async () => {
    h.serverInfo = { commit: "clientsha" };
    const { updateReady } = await loadPwa();
    expect(updateReady()).toBe(false);
  });

  it("is true on a server restart — the transient deploy signal", async () => {
    h.lifecycleKind = "restarted";
    const { updateReady } = await loadPwa();
    expect(updateReady()).toBe(true);
  });

  it("is true when the client commit provably differs from the server's — the durable signal", async () => {
    vi.stubGlobal("__KOLU_COMMIT__", "617b80d");
    h.serverInfo = { commit: "d5aed3c" };
    const { updateReady } = await loadPwa();
    expect(updateReady()).toBe(true);
  });

  it("is false on a dev/dirty build even when the commit strings differ", async () => {
    vi.stubGlobal("__KOLU_COMMIT__", "dev");
    h.serverInfo = { commit: "d5aed3c" };
    const { updateReady } = await loadPwa();
    expect(updateReady()).toBe(false);
  });
});

describe("reloadForUpdate", () => {
  it("does a plain reload (no SW to activate; the no-store shell makes it fresh)", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const { reloadForUpdate } = await loadPwa();
    reloadForUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("retireServiceWorker", () => {
  it("unregisters every worker and deletes every cache when the SW API is present", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const getRegistrations = vi
      .fn()
      .mockResolvedValue([{ unregister }, { unregister }]);
    const cacheDelete = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } });
    vi.stubGlobal("caches", {
      keys: vi.fn().mockResolvedValue(["v1", "v2"]),
      delete: cacheDelete,
    });
    const { retireServiceWorker } = await loadPwa();
    retireServiceWorker();
    await flush();
    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledTimes(2);
    expect(cacheDelete).toHaveBeenCalledTimes(2);
  });

  it("is a no-op on an origin without the SW API (plain HTTP/LAN)", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const { retireServiceWorker } = await loadPwa();
    expect(() => retireServiceWorker()).not.toThrow();
  });
});
