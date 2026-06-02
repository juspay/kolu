import type { RegisterSWOptions } from "virtual:pwa-register";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `virtual:pwa-register` is a Vite-plugin virtual module — unresolvable under
 *  Vitest (the PWA plugin isn't in the test config). Mock it: capture the
 *  options `initPwa` hands `registerSW`, and hand back a spy standing in for
 *  the `updateServiceWorker` function it returns. */
const h = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  updateSW: undefined as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (opts: RegisterSWOptions) => {
    h.options = opts;
    h.updateSW = vi.fn().mockResolvedValue(undefined);
    return h.updateSW;
  },
}));

/** pwa.ts holds module-level signal + registration state; re-import per test so
 *  each case starts clean. */
function loadPwa() {
  return import("./pwa");
}

const fakeReg = () =>
  ({ update: vi.fn().mockResolvedValue(undefined) }) as unknown as {
    update: ReturnType<typeof vi.fn>;
  } & ServiceWorkerRegistration;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  h.options = undefined;
  h.updateSW = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pwa service-worker update wiring", () => {
  it("registers immediately and starts with no update pending", async () => {
    const { initPwa, swUpdateReady } = await loadPwa();
    initPwa();
    expect(h.options?.immediate).toBe(true);
    expect(swUpdateReady()).toBe(false);
  });

  it("flips swUpdateReady once a fresh build is installed and waiting", async () => {
    const { initPwa, swUpdateReady } = await loadPwa();
    initPwa();
    expect(swUpdateReady()).toBe(false);
    h.options?.onNeedRefresh?.();
    expect(swUpdateReady()).toBe(true);
  });

  it("checkForUpdate nudges the registration to look for a new build", async () => {
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
    const { initPwa } = await loadPwa();
    initPwa();
    const reg = fakeReg();
    h.options?.onRegisteredSW?.("/sw.js", reg);
    expect(reg.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(reg.update).toHaveBeenCalled();
  });

  it("reloadForUpdate applies the waiting build via the service worker", async () => {
    const { initPwa, reloadForUpdate } = await loadPwa();
    initPwa();
    reloadForUpdate();
    expect(h.updateSW).toHaveBeenCalledWith(true);
  });

  it("reloadForUpdate falls back to a plain reload when there is no worker", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    // initPwa not called -> no registered worker -> plain reload (already fresh
    // with no SW intercepting and the shell served no-cache).
    const { reloadForUpdate } = await loadPwa();
    reloadForUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });
});
