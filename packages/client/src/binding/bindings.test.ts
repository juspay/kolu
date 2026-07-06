/**
 * The host binding + the MISROUTE GUARD (W4 "the switch"). Drives the real
 * `switchHost` / `activeBinding` with `connectSurfaces` mocked, so no socket is
 * opened. Pins the coordinator's condition 3a: switching hosts retires the old
 * binding and closes its socket, so a stale reference to it is REJECTED at the dead
 * transport (never silently routed to the wrong — or a dead — host).
 */

import { createRoot } from "solid-js";
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
// distinct objects). `link.hosts.add`/`remove` resolve immediately unless the epoch
// test opts into `deferAdds` — then each add parks until manually released, so two
// picks can be in flight at once. The ws captures its `close` listeners so a test can
// fire the server's `close(1008)` rejection.
let connectCount = 0;
let deferAdds = false;
const addReleasers: Array<() => void> = [];
function makeAdd() {
  return vi.fn(
    (): Promise<void> =>
      deferAdds
        ? new Promise<void>((resolve) => addReleasers.push(resolve))
        : Promise.resolve(),
  );
}
const connectSurfaces = vi.fn(() => {
  connectCount += 1;
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  return {
    clients: { kolu: {}, surfaceApp: {}, padi: {} },
    link: {
      hosts: { add: makeAdd(), remove: vi.fn(async () => {}) },
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

const {
  activeBinding,
  activeHost,
  bindingScoped,
  LOCAL_HOST,
  restoreStoredHost,
  switchHost,
} = await import("./bindings");

beforeEach(() => {
  store.clear();
});

describe("bindingScoped populates synchronously (no undefined-first-render)", () => {
  it("has the factory result on the FIRST read, before any effect phase", () => {
    const marker = { kind: "sub" } as const;
    // A render effect (not a deferred createEffect) must have set the value by the
    // time bindingScoped returns — else a consumer reading `X()().byKey(...)` /
    // `X()().value()` on the first synchronous render hits `undefined.<member>`.
    const value = createRoot(() => bindingScoped(() => marker)());
    expect(value).toBe(marker);
  });
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

describe("the switch epoch guard (C1)", () => {
  beforeEach(async () => {
    deferAdds = false;
    addReleasers.length = 0;
    await switchHost(LOCAL_HOST); // reset to a known host between tests
  });

  it("re-picking the CURRENT host cancels an in-flight add — no yank (hole 1)", async () => {
    expect(activeHost()).toBe(LOCAL_HOST);
    deferAdds = true;
    // Pick a remote host — its add PARKS (adds take seconds over ssh).
    const pickA = switchHost("A");
    // Re-pick the current host (local) as a cancel gesture — bumps the epoch even
    // though it early-returns (that placement is the fix).
    await switchHost(LOCAL_HOST);
    // A's add now resolves — but its pick is stale, so it must NOT yank the tab.
    for (const release of addReleasers) release();
    await pickA;
    expect(activeHost()).toBe(LOCAL_HOST);
  });

  it("two overlapping picks: the LAST pick wins, not the first to resolve (hole 2)", async () => {
    deferAdds = true;
    const pickB = switchHost("B"); // parks
    const pickC = switchHost("C"); // parks — the later pick
    // Release both; B parked first, so B's add resolves first — yet C must win.
    for (const release of addReleasers) release();
    await Promise.all([pickB, pickC]);
    expect(activeHost()).toBe("C");
  });
});

describe("per-tab host persistence (F-c: two-tabs independence)", () => {
  beforeEach(async () => {
    deferAdds = false;
    addReleasers.length = 0;
    await switchHost(LOCAL_HOST);
    store.clear(); // start each test with a clean (session)storage
  });

  it("writes the active host to sessionStorage — per-tab, NOT localStorage", async () => {
    await switchHost("box2");
    // The test stubs ONLY sessionStorage (as `store`); a regression to localStorage
    // would leave `store` empty here (and leak the pick across tabs on the origin).
    expect(store.get("kolu-active-host")).toBe("box2");
  });

  it("restoreStoredHost re-reads sessionStorage so a reload lands on the viewed host", () => {
    // Model a fresh tab load whose sessionStorage carries a prior pick.
    store.set("kolu-active-host", "box5");
    restoreStoredHost();
    expect(activeHost()).toBe("box5");
  });
});

describe("stale-call rejection — the misroute guard's REAL teeth (F-b)", () => {
  it("a call on a retired binding's socket THROWS (not just: retireSocket was called)", async () => {
    // The rest of this suite mocks `retireSocket`, which proves the wiring (dispose
    // calls it with the old socket) but NOT that a stale call actually rejects. Drive
    // the REAL `retireSocket` here to pin the teeth: after a switch retires a binding,
    // an in-flight call minted on its socket throws at the dead transport rather than
    // silently reconnecting to (and landing on) the now-wrong host.
    const { retireSocket } = await vi.importActual<
      typeof import("@kolu/surface-app/solid")
    >("@kolu/surface-app/solid");
    const ws = { close: vi.fn(), send: vi.fn() };
    ws.send("a live call"); // pre-retirement: the socket sends normally
    expect(ws.send).toHaveBeenCalledWith("a live call");

    retireSocket(ws); // what makeBinding.dispose() does on a switch
    expect(ws.close).toHaveBeenCalled();
    // The stale in-flight call now REJECTS at the transport.
    expect(() => ws.send("a stale in-flight call")).toThrow();
  });
});
