import type { ServerLifecycleEvent } from "./rpc/rpc";
import type { RegisterSWOptions } from "virtual:pwa-register";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `virtual:pwa-register` is a Vite-plugin virtual module — unresolvable under
 *  Vitest (the PWA plugin isn't in the test config). Mock it: capture the
 *  options `initPwa` hands `registerSW`, and hand back a spy standing in for
 *  the `updateServiceWorker` function it returns. Note `registerSW` returns
 *  this spy unconditionally — even on plain HTTP where no SW registers — which
 *  is exactly why `reloadForUpdate` must not treat "function defined" as "SW
 *  present" (see the no-SW reload test below). */
const h = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  updateSW: undefined as ReturnType<typeof vi.fn> | undefined,
  lifecycleKind: "connected" as ServerLifecycleEvent["kind"],
  serverInfo: undefined as { commit?: string } | undefined,
}));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (opts: RegisterSWOptions) => {
    h.options = opts;
    h.updateSW = vi.fn().mockResolvedValue(undefined);
    return h.updateSW;
  },
}));

/** `./rpc/rpc` opens a live PartySocket at module-eval and isn't importable
 *  under Vitest. Mock it down to the one accessor pwa.ts reads — `lifecycle()`
 *  — driven by `h.lifecycleKind` so tests can simulate a server restart. */
vi.mock("./rpc/rpc", () => ({
  lifecycle: () => ({ kind: h.lifecycleKind }),
  serverInfo: () => h.serverInfo,
}));

/** pwa.ts holds module-level signal + registration state, and reads
 *  `navigator` at import time for `serviceWorkerSupported`; re-import per test
 *  (after any `navigator` stub) so each case starts clean. */
function loadPwa() {
  return import("./pwa");
}

const fakeReg = () =>
  ({ update: vi.fn().mockResolvedValue(undefined) }) as unknown as {
    update: ReturnType<typeof vi.fn>;
  } & ServiceWorkerRegistration;

/** Make `serviceWorkerSupported` evaluate `true` on the next `loadPwa()`. The
 *  node test env has a `navigator` with no `serviceWorker`, matching HTTP/LAN
 *  by default; stub one in to simulate a secure context. */
function withServiceWorker() {
  vi.stubGlobal("navigator", { serviceWorker: {}, onLine: true });
  // `serviceWorkerSupported` now also requires an HTTPS origin (see pwa.ts), so
  // an https `location` is part of simulating a secure context.
  vi.stubGlobal("location", { protocol: "https:", reload: vi.fn() });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  h.options = undefined;
  h.updateSW = undefined;
  h.lifecycleKind = "connected";
  h.serverInfo = undefined;
  // pwa.ts reads `__KOLU_COMMIT__` (a build-time define) on the no-SW path.
  vi.stubGlobal("__KOLU_COMMIT__", "clientsha");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pwa service-worker update wiring", () => {
  it("registers immediately and starts with no update pending", async () => {
    withServiceWorker();
    const { initPwa, updateReady } = await loadPwa();
    initPwa();
    expect(h.options?.immediate).toBe(true);
    expect(updateReady()).toBe(false);
  });

  it("flips updateReady once a fresh build is installed and waiting", async () => {
    withServiceWorker();
    const { initPwa, updateReady } = await loadPwa();
    initPwa();
    expect(updateReady()).toBe(false);
    h.options?.onNeedRefresh?.();
    expect(updateReady()).toBe(true);
  });

  it("checkForUpdate nudges the registration to look for a new build", async () => {
    withServiceWorker();
    const { initPwa, checkForUpdate } = await loadPwa();
    initPwa();
    const reg = fakeReg();
    h.options?.onRegisteredSW?.("/sw.js", reg);
    checkForUpdate();
    expect(reg.update).toHaveBeenCalledOnce();
  });

  it("checkForUpdate is a no-op before registration resolves (e.g. HTTP/LAN)", async () => {
    const { initPwa, checkForUpdate } = await loadPwa();
    initPwa();
    expect(() => checkForUpdate()).not.toThrow();
  });

  it("polls the registration for a new build on an interval", async () => {
    withServiceWorker();
    const { initPwa } = await loadPwa();
    initPwa();
    const reg = fakeReg();
    h.options?.onRegisteredSW?.("/sw.js", reg);
    expect(reg.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(reg.update).toHaveBeenCalled();
  });

  it("reloadForUpdate applies the waiting build via the service worker", async () => {
    withServiceWorker();
    const { initPwa, reloadForUpdate } = await loadPwa();
    initPwa();
    reloadForUpdate();
    expect(h.updateSW).toHaveBeenCalledWith(true);
  });

  describe("no service worker (plain HTTP / LAN)", () => {
    it("production initPwa() with no SW still gives a working reload", async () => {
      // The node env's navigator has no `serviceWorker`, matching HTTP/LAN —
      // do NOT stub one in. `registerSW` still returns its `updateSW` spy, but
      // that spy is an inert no-op there: reloadForUpdate must NOT call it (it
      // would silently fail to reload). It must hit `location.reload()`.
      const reload = vi.fn();
      vi.stubGlobal("location", { reload });
      const { initPwa, reloadForUpdate } = await loadPwa();
      initPwa(); // assigns updateServiceWorker (defined-but-inert)
      reloadForUpdate();
      expect(h.updateSW).not.toHaveBeenCalled();
      expect(reload).toHaveBeenCalledOnce();
    });

    it("falls back to a plain reload even when initPwa was never called", async () => {
      const reload = vi.fn();
      vi.stubGlobal("location", { reload });
      const { reloadForUpdate } = await loadPwa();
      reloadForUpdate();
      expect(reload).toHaveBeenCalledOnce();
    });

    it("surfaces the reload prompt on a server restart (no onNeedRefresh fires)", async () => {
      // With no SW, `onNeedRefresh` can never fire, so updateReady falls back
      // to the lifecycle signal: a server restart means a deploy likely shipped
      // new assets, so offer a reload.
      const { initPwa, updateReady } = await loadPwa();
      initPwa();
      expect(updateReady()).toBe(false);
      h.lifecycleKind = "restarted";
      expect(updateReady()).toBe(true);
    });

    it("surfaces the reload prompt when the client commit provably differs from the server's", async () => {
      // The durable backstop: a backgrounded tab that missed the restart event
      // still learns it's stale from the commit mismatch (the same signal the
      // `≠ srv` badge uses). reloadForUpdate() -> location.reload() lands fresh
      // because the server serves index.html `no-store`.
      vi.stubGlobal("__KOLU_COMMIT__", "617b80d");
      h.serverInfo = { commit: "d5aed3c" };
      const { initPwa, updateReady } = await loadPwa();
      initPwa();
      expect(updateReady()).toBe(true);
    });

    it("does not prompt when the client and server commits match", async () => {
      vi.stubGlobal("__KOLU_COMMIT__", "d5aed3c");
      h.serverInfo = { commit: "d5aed3c" };
      const { initPwa, updateReady } = await loadPwa();
      initPwa();
      expect(updateReady()).toBe(false);
    });

    it("does not prompt on a dev/dirty build even when the strings differ", async () => {
      // clientIsStale only fires on two CLEAN refs, so a dev build can't
      // false-positive into a perpetual reload nag.
      vi.stubGlobal("__KOLU_COMMIT__", "dev");
      h.serverInfo = { commit: "d5aed3c" };
      const { initPwa, updateReady } = await loadPwa();
      initPwa();
      expect(updateReady()).toBe(false);
    });
  });
});
