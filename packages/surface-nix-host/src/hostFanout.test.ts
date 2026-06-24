import { defineSurface } from "@kolu/surface/define";
import type { AnyContractRouter } from "@orpc/contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  buildHostRegistry,
  type ClosableSocket,
  type HostEntry,
  type LiveSpawnHolder,
  pumpRemoteSurface,
} from "./hostFanout";
import type { AgentClient, HostSession } from "./hostSession";

/** A stand-in for the slice of `HostSession` the registry touches
 *  (`destroy`/`reconnect`/`recheck`). `HostSession` is a class, so we mint a
 *  structural stub with spies and cast at the `buildEntry` boundary — the
 *  registry never reaches past these three methods. */
function fakeSession() {
  const session = {
    destroy: vi.fn(),
    reconnect: vi.fn(),
    recheck: vi.fn(),
  };
  return session as typeof session & HostSession<AnyContractRouter>;
}

type Handler = { id: string };

/** Build a registry whose `buildEntry` records each host's stub session +
 *  handler so a test can assert against them, plus a `persist` spy. */
function harness(initialHosts: readonly string[]) {
  const built = new Map<string, HostEntry<AnyContractRouter, Handler>>();
  const persist = vi.fn(async (_hosts: string[]) => {});
  const registry = buildHostRegistry<AnyContractRouter, Handler>({
    initialHosts,
    persist,
    buildEntry: (host) => {
      const entry: HostEntry<AnyContractRouter, Handler> = {
        session: fakeSession(),
        handler: { id: host },
      };
      built.set(host, entry);
      return entry;
    },
  });
  return { registry, built, persist };
}

const socket = () => {
  const close = vi.fn<(code: number, reason?: string) => void>();
  return { close } satisfies ClosableSocket;
};

describe("buildHostRegistry", () => {
  it("seeds initial hosts synchronously, in insertion order", () => {
    const { registry } = harness(["alpha", "beta"]);
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
    expect(registry.has("alpha")).toBe(true);
    expect(registry.has("ghost")).toBe(false);
    expect(registry.getHandler("beta")).toEqual({ id: "beta" });
    expect(registry.getHandler("ghost")).toBeUndefined();
  });

  it("does NOT persist the initial seed (only mutations persist)", () => {
    const { persist } = harness(["alpha"]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects a DUPLICATE in the seed before building any entry (F6)", () => {
    // A duplicate would otherwise `Map.set`-collapse onto the first AFTER
    // `buildEntry` already started a pump/pinned a session for it — a leaked
    // background loop for a config typo. The throw must fire before any
    // `buildEntry` side effect.
    const built = new Map<string, HostEntry<AnyContractRouter, Handler>>();
    expect(() =>
      buildHostRegistry<AnyContractRouter, Handler>({
        initialHosts: ["alpha", "beta", "alpha"],
        buildEntry: (host) => {
          const entry: HostEntry<AnyContractRouter, Handler> = {
            session: fakeSession(),
            handler: { id: host },
          };
          built.set(host, entry);
          return entry;
        },
      }),
    ).toThrow(/duplicate host.*alpha/);
    // The duplicate is rejected up front (before the build loop), so NO entry —
    // and thus no pump/pinned session — was created for any host.
    expect(built.size).toBe(0);
  });

  it("add() builds an entry, persists the full set, and rejects duplicates", async () => {
    const { registry, persist } = harness(["alpha"]);
    await registry.add("beta");
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
    expect(persist).toHaveBeenCalledWith(["alpha", "beta"]);
    await expect(registry.add("beta")).rejects.toThrow("host already exists");
  });

  it("remove() destroys the session, evicts open sockets, and persists", async () => {
    const { registry, built } = harness(["alpha", "beta"]);
    const ws = socket();
    registry.registerConnection("alpha", ws);
    await registry.remove("alpha");
    expect(registry.has("alpha")).toBe(false);
    expect(registry.hosts()).toEqual(["beta"]);
    expect(built.get("alpha")?.session.destroy).toHaveBeenCalledOnce();
    expect(ws.close).toHaveBeenCalledWith(1000, "host removed");
  });

  it("add() persists BEFORE committing — a persist reject leaves nothing added and tears the new session down", async () => {
    const built = new Map<string, HostEntry<AnyContractRouter, Handler>>();
    const persist = vi
      .fn<(hosts: string[]) => Promise<void>>()
      .mockRejectedValue(new Error("disk full"));
    const registry = buildHostRegistry<AnyContractRouter, Handler>({
      initialHosts: ["alpha"],
      persist,
      buildEntry: (host) => {
        const entry: HostEntry<AnyContractRouter, Handler> = {
          session: fakeSession(),
          handler: { id: host },
        };
        built.set(host, entry);
        return entry;
      },
    });
    await expect(registry.add("beta")).rejects.toThrow("disk full");
    // Persist was attempted with the intended next set…
    expect(persist).toHaveBeenCalledWith(["alpha", "beta"]);
    // …but the host was NOT added, and the just-built session was torn down so
    // it doesn't leak (memory + disk both still exclude beta).
    expect(registry.has("beta")).toBe(false);
    expect(registry.hosts()).toEqual(["alpha"]);
    expect(built.get("beta")?.session.destroy).toHaveBeenCalledOnce();
  });

  it("remove() persists BEFORE committing — a persist reject leaves the host fully live", async () => {
    const built = new Map<string, HostEntry<AnyContractRouter, Handler>>();
    const persist = vi
      .fn<(hosts: string[]) => Promise<void>>()
      .mockRejectedValue(new Error("disk full"));
    const registry = buildHostRegistry<AnyContractRouter, Handler>({
      initialHosts: ["alpha", "beta"],
      persist,
      buildEntry: (host) => {
        const entry: HostEntry<AnyContractRouter, Handler> = {
          session: fakeSession(),
          handler: { id: host },
        };
        built.set(host, entry);
        return entry;
      },
    });
    const ws = socket();
    registry.registerConnection("alpha", ws);
    await expect(registry.remove("alpha")).rejects.toThrow("disk full");
    expect(persist).toHaveBeenCalledWith(["beta"]);
    // Disk still lists alpha, so memory must too: session NOT destroyed, socket
    // NOT closed, still registered.
    expect(registry.has("alpha")).toBe(true);
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
    expect(built.get("alpha")?.session.destroy).not.toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("remove() is a no-op for an unknown host", async () => {
    const { registry, persist } = harness(["alpha"]);
    await registry.remove("ghost");
    expect(registry.hosts()).toEqual(["alpha"]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("a removed host's socket is NOT closed again on a later removal", async () => {
    const { registry } = harness(["alpha"]);
    const ws = socket();
    registry.registerConnection("alpha", ws);
    registry.unregisterConnection("alpha", ws);
    await registry.remove("alpha");
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("reconnect() re-arms only the named host's session", () => {
    const { registry, built } = harness(["alpha", "beta"]);
    registry.reconnect("alpha");
    expect(built.get("alpha")?.session.reconnect).toHaveBeenCalledOnce();
    expect(built.get("beta")?.session.reconnect).not.toHaveBeenCalled();
    // No-op for an unknown host (must not throw).
    expect(() => registry.reconnect("ghost")).not.toThrow();
  });

  it("recheckAll() cycles every host's session", () => {
    const { registry, built } = harness(["alpha", "beta"]);
    registry.recheckAll();
    expect(built.get("alpha")?.session.recheck).toHaveBeenCalledOnce();
    expect(built.get("beta")?.session.recheck).toHaveBeenCalledOnce();
  });

  it("destroyAll() tears down every session and empties the registry", () => {
    const { registry, built } = harness(["alpha", "beta"]);
    registry.destroyAll();
    expect(registry.hosts()).toEqual([]);
    expect(built.get("alpha")?.session.destroy).toHaveBeenCalledOnce();
    expect(built.get("beta")?.session.destroy).toHaveBeenCalledOnce();
  });

  it("works with no persist hook (a static host set)", async () => {
    const registry = buildHostRegistry<AnyContractRouter, Handler>({
      initialHosts: ["alpha"],
      buildEntry: (host) => ({ session: fakeSession(), handler: { id: host } }),
    });
    // add still works; it just skips persistence.
    await registry.add("beta");
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
  });
});

// ── pumpRemoteSurface — the `onLinkDown` wiring ────────────────────────────

/**
 * The pump's reconnect loop is the production caller of `onLinkDown` (pulam-web
 * wires it to `resetRemoteFold`). A regression that stops invoking it from the
 * `finally` would leave the consumer's fold-reset test green while the real
 * ghost-on-reconnect bug returns. These tests pin the pump-side guarantee
 * directly: `onLinkDown` fires when a spawn's mirror ends, AFTER the live
 * holders have been cleared.
 */

const pumpSurface = defineSurface({
  cells: {},
  collections: {},
  // One open stream — the mirror stays live until the source generator returns.
  streams: { ticks: { inputSchema: z.object({}), outputSchema: z.number() } },
  events: {},
});

/** A fake session exposing only the slice the pump + client-cursor read
 *  (`pin`/`isDestroyed`/`currentClient`/`onState`), driving exactly ONE spawn
 *  then destruction. `currentClient()` returns a stable promise (the cursor
 *  compares the promise identity, not the awaited client). Listeners fire on
 *  `destroy()` so the cursor's next wait observes `isDestroyed()` and the loop
 *  exits. */
function fakePumpSession(client: AgentClient<AnyContractRouter>) {
  const listeners = new Set<() => void>();
  let destroyed = false;
  const clientPromise = Promise.resolve(client);
  const session = {
    pin: () => clientPromise,
    isDestroyed: () => destroyed,
    currentClient: () => (destroyed ? null : clientPromise),
    onState: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => {
      destroyed = true;
      for (const cb of [...listeners]) cb();
    },
  };
  return session as typeof session & HostSession<AnyContractRouter>;
}

describe("pumpRemoteSurface — onLinkDown", () => {
  it("fires onLinkDown after a mirror ends, AFTER the live holders are cleared", async () => {
    // A `ticks` stream the test holds open, then closes to end the mirror.
    let closeTicks!: () => void;
    const ticksOpen = new Promise<void>((r) => {
      closeTicks = r;
    });
    const client = {
      surface: {
        ticks: {
          get: async () =>
            (async function* () {
              yield 1;
              await ticksOpen; // stay live until the test closes the link
            })(),
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: structural fake client; the mirror reads `.surface` structurally.
    } as any as AgentClient<AnyContractRouter>;

    const session = fakePumpSession(client);

    // Live holders the pump must clear BEFORE firing onLinkDown — assert that
    // ordering by snapshotting the holder's `.current` from inside the hook.
    const liveClient: LiveSpawnHolder<AgentClient<AnyContractRouter>> = {
      current: null,
    };
    let clientAtLinkDown: unknown = "unset";
    let linkDowns = 0;
    const onLinkDown = vi.fn(() => {
      linkDowns += 1;
      clientAtLinkDown = liveClient.current;
    });

    const pumping = pumpRemoteSurface({
      source: pumpSurface,
      session,
      // Subscribe `ticks` in the sink so the mirror actually holds it open — a
      // stream with NO sink entry is skipped, and `done` would settle at once.
      makeSink: () => ({
        cells: {},
        collections: {},
        streams: { ticks: { input: {}, onFrame: () => {} } },
        events: {},
      }),
      liveClient,
      onLinkDown,
    });

    // The spawn is live: the holder points at this client and onLinkDown has
    // not fired yet (the mirror is still open on the held `ticks` stream).
    await vi.waitFor(() => expect(liveClient.current).toBe(client));
    expect(onLinkDown).not.toHaveBeenCalled();

    // Link death: closing the stream ends the mirror → the pump's `finally`
    // clears the holders and fires onLinkDown.
    closeTicks();
    await vi.waitFor(() => expect(onLinkDown).toHaveBeenCalledOnce());
    // The hook saw the holder ALREADY cleared (the contract: per-link local
    // state resets only after the live client is gone, never against a stale
    // pointer to the dead spawn).
    expect(clientAtLinkDown).toBeNull();
    expect(liveClient.current).toBeNull();

    // End the loop and let the pump settle.
    session.destroy();
    await pumping;
    expect(linkDowns).toBe(1);
  });
});
