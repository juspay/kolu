/**
 * The host binding + the MISROUTE GUARD (W4 "the switch"). Drives the real
 * `switchHost` / `activeBinding` with `connectSurfaces` mocked, so no socket is
 * opened. Pins the coordinator's condition 3a: switching hosts retires the old
 * binding and closes its socket, so a stale reference to it is REJECTED at the dead
 * transport (never silently routed to the wrong — or a dead — host).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// bindings.ts reads `window.location` + `sessionStorage` at module load — stub them
// (the client vitest env is `node`). The active host is PER-TAB, so it persists in
// `sessionStorage` (survives a reload of this tab, scoped to this browsing context),
// not `localStorage` (which would leak the pick across every tab on the origin).
vi.stubGlobal("window", {
  location: { protocol: "http:", host: "kolu.test:8080" },
});
const store = new Map<string, string>();
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
});

// Each `connectSurfaces` call is a DISTINCT bundle (so two hosts' bindings are
// distinct objects). `link.hosts.add`/`remove` resolve immediately. The ws captures
// its `close` listeners so a test can fire the server's `close(1008)` rejection.
let connectCount = 0;
const connectSurfaces = vi.fn(() => {
  connectCount += 1;
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  return {
    clients: { kolu: {}, surfaceApp: {}, padi: {} },
    link: {
      hosts: { add: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
    ws: {
      close: vi.fn(),
      addEventListener: (type: string, cb: (ev: unknown) => void) => {
        (listeners[type] ??= []).push(cb);
      },
      __listeners: listeners,
    },
    echo: { remember: vi.fn() },
    dispose: vi.fn(),
    status: () => "live",
  };
});

/** Fire a `close` event on a binding's (mock) socket, as the server would. */
function fireClose(binding: { ws: unknown }, ev: { code: number }): void {
  const ws = binding.ws as {
    __listeners: Record<string, ((ev: unknown) => void)[]>;
  };
  for (const cb of ws.__listeners.close ?? []) cb(ev);
}

// The real `retireSocket` closes the socket + stubs `send` to throw; spy on it so
// the test can prove a switch actually retires the old host's socket (the misroute
// guard's real teeth), not just flips the `retired` flag.
const retireSocketMock = vi.fn();
vi.mock("@kolu/surface-app/solid", () => ({
  connectSurfaces,
  createServerLifecycle: vi.fn(() => ({
    lifecycle: () => ({ kind: "connected" }),
    serverProcessId: () => "pid",
    status: () => "live",
  })),
  surfaceAppProbe: vi.fn(),
  retireSocket: retireSocketMock,
}));
vi.mock("@kolu/surface-app", () => ({ STALE_PROCESS_CLOSE_CODE: 4001 }));
vi.mock("kolu-common/surfacesWithPadi", () => ({ surfacesWithPadi: {} }));
// `bindings.ts` imports `LOCAL_HOST` from `kolu-common/contract`, whose eval chain
// reaches `kolu-common/surface` — it references `HostDaemonInventorySchema` as a
// cell field. Keep the real schema (the client can't resolve `zod` directly to
// stand one in) and mock only `padiRpc`.
vi.mock("@kolu/padi/surface", async (importActual) => {
  const actual = await importActual<typeof import("@kolu/padi/surface")>();
  return {
    padiRpc: vi.fn(() => ({})),
    HostDaemonInventorySchema: actual.HostDaemonInventorySchema,
  };
});
vi.mock("solid-sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

const { activeBinding, activeHost, LOCAL_HOST, switchHost } = await import(
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

    // Switch to a remote host: it is added to the pool first (add-then-connect),
    // then the tab's binding swaps.
    await switchHost("zest");
    expect(local.link.hosts.add).toHaveBeenCalledWith({ host: "zest" });

    // The OLD (local) binding is retired + its socket torn down — the misroute
    // guard's teeth: the dispose closure sets `retired` AND retires (closes +
    // poisons `send`) the socket, so a late call on it throws at the now-dead
    // transport rather than silently re-dialing this host after the tab moved on.
    expect(local.retired).toBe(true);
    expect(retireSocketMock).toHaveBeenCalledWith(local.ws);

    // The NEW active binding is a DISTINCT, live object for the switched-to host.
    const remote = activeBinding();
    expect(remote).not.toBe(local);
    expect(remote.host).toBe("zest");
    expect(remote.retired).toBe(false);
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

describe("a removed host falls the tab back to local (close 1008)", () => {
  it("stops the reconnect loop and switches to local when the server rejects the host as unknown", async () => {
    await switchHost("gone");
    const remote = activeBinding();
    expect(remote.host).toBe("gone");

    // Another device removed "gone" from the shared pool, so this tab's (re)connect
    // is rejected `close(1008)`. Without the fallback a PartySocket would re-dial the
    // gone host forever; instead the tab falls back to local.
    fireClose(remote, { code: 1008 });
    expect(activeHost()).toBe(LOCAL_HOST);
  });

  it("ignores an ORDINARY disconnect (only 1008 = unknown host triggers the fallback)", async () => {
    await switchHost("box2");
    expect(activeHost()).toBe("box2");

    // A transient drop (1006) is PartySocket's job to reconnect — the tab must NOT
    // abandon the host it's viewing on every blip.
    fireClose(activeBinding(), { code: 1006 });
    expect(activeHost()).toBe("box2");
  });
});
