/**
 * The host binding + the MISROUTE GUARD (W4 "the switch"). Drives the real
 * `switchHost` / `activeBinding` / `assertLive` with `connectSurfaces` mocked, so
 * no socket is opened. Pins the coordinator's condition 3a: switching hosts retires
 * the old binding, and a stale reference to it is REJECTED (never silently routed to
 * the wrong — or a dead — host).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// bindings.ts reads `window.location` + `localStorage` at module load — stub them
// (the client vitest env is `node`).
vi.stubGlobal("window", {
  location: { protocol: "http:", host: "kolu.test:8080" },
});
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
});

// Each `connectSurfaces` call is a DISTINCT bundle (so two hosts' bindings are
// distinct objects). `link.hosts.add`/`remove` resolve immediately.
let connectCount = 0;
const connectSurfaces = vi.fn(() => {
  connectCount += 1;
  return {
    clients: { kolu: {}, surfaceApp: {}, padi: {} },
    link: {
      hosts: { add: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
    ws: { close: vi.fn(), addEventListener: vi.fn() },
    echo: { remember: vi.fn() },
    dispose: vi.fn(),
    status: () => "live",
  };
});

vi.mock("@kolu/surface-app/solid", () => ({
  connectSurfaces,
  createServerLifecycle: vi.fn(() => ({
    lifecycle: () => ({ kind: "connected" }),
    serverProcessId: () => "pid",
    status: () => "live",
  })),
  surfaceAppProbe: vi.fn(),
  retireSocket: vi.fn(),
}));
vi.mock("@kolu/surface-app", () => ({ STALE_PROCESS_CLOSE_CODE: 4001 }));
vi.mock("kolu-common/surfacesWithPadi", () => ({ surfacesWithPadi: {} }));
vi.mock("@kolu/padi/surface", () => ({ padiRpc: vi.fn(() => ({})) }));
vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

const { activeBinding, assertLive, LOCAL_HOST, switchHost } = await import(
  "./bindings"
);

beforeEach(() => {
  store.clear();
});

describe("the misroute guard (condition 3a)", () => {
  it("retires the old binding on a switch, and a stale reference to it is rejected", async () => {
    // Start on the local host.
    const local = activeBinding();
    expect(local.host).toBe(LOCAL_HOST);
    expect(local.retired).toBe(false);
    expect(() => assertLive(local)).not.toThrow();

    // Switch to a remote host: it is added to the pool first (add-then-connect),
    // then the tab's binding swaps.
    await switchHost("zest");
    expect(local.link.hosts.add).toHaveBeenCalledWith({ host: "zest" });

    // The OLD (local) binding is retired + its socket torn down — the misroute
    // guard's teeth: a call still holding the local binding now throws, instead of
    // silently landing on the wrong (or dead) host. `retired === true` is set inside
    // the dispose closure, so it proves the teardown ran (which closes the socket).
    expect(local.retired).toBe(true);
    expect(() => assertLive(local)).toThrow(/stale binding for host "local"/);

    // The NEW active binding is a DISTINCT, live object for the switched-to host.
    const remote = activeBinding();
    expect(remote).not.toBe(local);
    expect(remote.host).toBe("zest");
    expect(() => assertLive(remote)).not.toThrow();
  });

  it("switching back to a previously-retired host builds a fresh binding (never reuses the retired one)", async () => {
    const local1 = activeBinding();
    await switchHost("zest");
    await switchHost(LOCAL_HOST);
    const local2 = activeBinding();
    expect(local2.host).toBe(LOCAL_HOST);
    // A brand-new binding for local — the retired one is never resurrected.
    expect(local2).not.toBe(local1);
    expect(local2.retired).toBe(false);
  });

  it("switching to the SAME host is a no-op (no re-add, no re-dial)", async () => {
    const before = activeBinding();
    const count = connectCount;
    await switchHost(before.host);
    expect(activeBinding()).toBe(before);
    expect(connectCount).toBe(count);
  });
});
