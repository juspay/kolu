import { defineSurface } from "@kolu/surface/define";
import type { SurfaceClientLike } from "@kolu/surface/project";
import { describe, expect, it, type Mock, vi } from "vitest";
import { z } from "zod";
import {
  buildRemotePool,
  type ClosableSocket,
  type LiveSpawnHolder,
  pumpRemoteSurface,
  type RemoteEntry,
} from "./hostFanout";
import type { Session } from "./session";

/** A stand-in for the slice of a session the registry + its `controls` touch: the
 *  minimal `DestroyableSession` (`destroy`) the registry itself calls, plus
 *  `reconnect`/`recheck` the fleet `controls` invoke. A structural stub with spies —
 *  the registry never reaches past these three. */
interface FakeSession {
  destroy: Mock;
  reconnect: Mock;
  recheck: Mock;
}
function fakeSession(): FakeSession {
  return { destroy: vi.fn(), reconnect: vi.fn(), recheck: vi.fn() };
}

type Handler = { id: string };

/** Build a registry whose `buildEntry` records each host's stub session +
 *  handler so a test can assert against them, plus a `persist` spy. Built WITH
 *  `controls` (S2), so `registry.reconnect(host)`/`recheckAll()` exist and pass
 *  through to each stub session's `reconnect`/`recheck`. */
function harness(initialHosts: readonly string[]) {
  const built = new Map<string, RemoteEntry<FakeSession, Handler>>();
  const persist = vi.fn(async (_hosts: string[]) => {});
  const registry = buildRemotePool<FakeSession, Handler>({
    initialHosts,
    persist,
    buildEntry: (host) => {
      const entry: RemoteEntry<FakeSession, Handler> = {
        session: fakeSession(),
        handler: { id: host },
      };
      built.set(host, entry);
      return entry;
    },
    controls: {
      reconnect: (s) => s.reconnect(),
      recheck: (s) => s.recheck(),
    },
  });
  return { registry, built, persist };
}

const socket = () => {
  const close = vi.fn<(code: number, reason?: string) => void>();
  return { close } satisfies ClosableSocket;
};

describe("buildRemotePool", () => {
  it("seeds initial hosts synchronously, in insertion order", () => {
    const { registry } = harness(["alpha", "beta"]);
    expect(registry.hosts()).toEqual(["alpha", "beta"]);
    expect(registry.has("alpha")).toBe(true);
    expect(registry.has("ghost")).toBe(false);
    // `getHandler` returns the whole entry (membership signalled by ENTRY
    // presence, not by the handler value — see the interface doc) so an `H`
    // that itself admits `undefined` can't be confused with "unknown host".
    expect(registry.getHandler("beta")?.handler).toEqual({ id: "beta" });
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
    const built = new Map<string, RemoteEntry<FakeSession, Handler>>();
    expect(() =>
      buildRemotePool<FakeSession, Handler>({
        initialHosts: ["alpha", "beta", "alpha"],
        buildEntry: (host) => {
          const entry: RemoteEntry<FakeSession, Handler> = {
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

  it("retire() tears the host down EXACTLY like remove() — but does NOT persist", async () => {
    const { registry, built, persist } = harness(["alpha", "beta"]);
    const ws = socket();
    registry.registerConnection("alpha", ws);
    await registry.retire("alpha");
    // Same LIVE teardown as remove: gone from membership, session destroyed, socket closed.
    expect(registry.has("alpha")).toBe(false);
    expect(registry.hosts()).toEqual(["beta"]);
    expect(built.get("alpha")?.session.destroy).toHaveBeenCalledOnce();
    expect(ws.close).toHaveBeenCalledWith(1000, "host removed");
    // …but the departure is NOT written — an internal shed leaves the host remembered,
    // so a membership store re-seeds it next boot. This is the whole point of the verb split.
    expect(persist).not.toHaveBeenCalled();
  });

  it("retire() on an unknown host is a no-op (no persist, no throw)", async () => {
    const { registry, persist } = harness(["alpha"]);
    await expect(registry.retire("ghost")).resolves.toBeUndefined();
    expect(registry.hosts()).toEqual(["alpha"]);
    expect(persist).not.toHaveBeenCalled();
  });

  it("retire() swallows a destroy() fault and RESOLVES — a fire-and-forget void retire can't go fatal", async () => {
    const { registry, built } = harness(["alpha", "beta"]);
    built.get("alpha")?.session.destroy.mockImplementation(() => {
      throw new Error("ssh child kill faulted");
    });
    // No persist step + a swallowed teardown fault ⇒ retire() never rejects, so
    // `void pool.retire(h)` needs no `.catch` to stay off the fatal handler (unlike
    // remove(), whose persist step CAN reject).
    await expect(registry.retire("alpha")).resolves.toBeUndefined();
    expect(registry.has("alpha")).toBe(false);
    expect(registry.has("beta")).toBe(true);
    expect(built.get("beta")?.session.destroy).not.toHaveBeenCalled();
  });

  it("ISOLATION: a session.destroy() that THROWS on one guest's remove doesn't crash the pool — the OTHER entries survive", async () => {
    const { registry, built } = harness(["alpha", "beta"]);
    // Make alpha's teardown FAULT: `session.destroy()` can throw (it kills the ssh child +
    // clears timers — documented + guarded in dialAgentOnce.ts). kolu calls `remove()`
    // fire-and-forget (`void pool.remove(h)`), so an UNGUARDED throw would float an
    // unhandledRejection → the deliberately-fatal `process.exit(1)`, taking down the WHOLE
    // server on ONE guest's teardown.
    built.get("alpha")?.session.destroy.mockImplementation(() => {
      throw new Error("ssh child kill faulted");
    });
    // The guard swallows the throw, so remove() RESOLVES — no floating rejection to go fatal.
    await expect(registry.remove("alpha")).resolves.toBeUndefined();
    // The ISOLATION PROMISE the feature makes: the pool is alive and the OTHER host is
    // untouched — still a member (its subs keep streaming), its session never destroyed. A
    // teardown fault on one guest does NOT cascade to the rest.
    expect(registry.has("alpha")).toBe(false); // alpha left membership (typed-end), as intended
    expect(registry.has("beta")).toBe(true);
    expect(registry.hosts()).toEqual(["beta"]);
    expect(built.get("beta")?.session.destroy).not.toHaveBeenCalled();
  });

  it("add() persists BEFORE committing — a persist reject leaves nothing added and tears the new session down", async () => {
    const built = new Map<string, RemoteEntry<FakeSession, Handler>>();
    const persist = vi
      .fn<(hosts: string[]) => Promise<void>>()
      .mockRejectedValue(new Error("disk full"));
    const registry = buildRemotePool<FakeSession, Handler>({
      initialHosts: ["alpha"],
      persist,
      buildEntry: (host) => {
        const entry: RemoteEntry<FakeSession, Handler> = {
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
    const built = new Map<string, RemoteEntry<FakeSession, Handler>>();
    const persist = vi
      .fn<(hosts: string[]) => Promise<void>>()
      .mockRejectedValue(new Error("disk full"));
    const registry = buildRemotePool<FakeSession, Handler>({
      initialHosts: ["alpha", "beta"],
      persist,
      buildEntry: (host) => {
        const entry: RemoteEntry<FakeSession, Handler> = {
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

  it("CONCURRENCY: N adds fired without awaiting between them never lose a host on disk (serialized persist)", async () => {
    // Repro for the false "transactional" claim: `add` used to read `entries.keys()`
    // as a PRE-await snapshot and commit it POST-await, with no ordering between
    // concurrent callers — a browser double-click (or add+remove) races exactly
    // this. Each `persist` call here does a real microtask hop before recording,
    // so a racy implementation actually interleaves rather than happening to run
    // to completion synchronously.
    const persisted: string[][] = [];
    const persist = vi.fn(async (hosts: string[]) => {
      await Promise.resolve();
      persisted.push(hosts);
    });
    const registry = buildRemotePool<FakeSession, Handler>({
      initialHosts: ["alpha"],
      persist,
      buildEntry: (host) => ({ session: fakeSession(), handler: { id: host } }),
    });

    // Fire three adds WITHOUT awaiting between them — the race.
    const adds = ["beta", "gamma", "delta"].map((h) => registry.add(h));
    await Promise.all(adds);

    // Every host landed in memory…
    expect(registry.hosts()).toEqual(["alpha", "beta", "gamma", "delta"]);
    // …and the LAST write to "disk" reflects the SAME final set — serialized
    // mutations mean the third add's persisted list was computed AFTER the first
    // two committed, never off a stale snapshot that drops one of them. Before the
    // fix, each add computed its next-list from the pre-mutation ["alpha"] snapshot,
    // so the last persisted list undercounted (e.g. just ["alpha", "delta"]) even
    // though memory held all three.
    expect(persisted.at(-1)).toEqual(registry.hosts());
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

  it("destroyAll() drops membership BEFORE destroying, and one throwing destroy() does not strand the rest (mirrors remove()'s ordering + guard)", () => {
    const { registry, built } = harness(["alpha", "beta", "gamma"]);
    let membershipAtDestroy: string[] | undefined;
    registry.subscribe(() => {
      // Fires once, from destroyAll's own notifyMembership — membership must
      // already be empty by the time any destroy() fault could reach a listener.
      membershipAtDestroy = registry.hosts();
    });
    built.get("beta")!.session.destroy.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => registry.destroyAll()).not.toThrow();
    expect(membershipAtDestroy).toEqual([]);
    expect(registry.hosts()).toEqual([]);
    // The throwing session AND its neighbors all got a destroy() call — one
    // fault didn't abort the loop and strand the others un-destroyed.
    expect(built.get("alpha")?.session.destroy).toHaveBeenCalledOnce();
    expect(built.get("beta")?.session.destroy).toHaveBeenCalledOnce();
    expect(built.get("gamma")?.session.destroy).toHaveBeenCalledOnce();
  });

  it("works with no persist hook (a static host set)", async () => {
    const registry = buildRemotePool<FakeSession, Handler>({
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
function fakePumpSession(client: SurfaceClientLike) {
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
  // The pump reads only pin/isDestroyed/currentClient/onState; cast to the full
  // Session role (markConnected/reconnect/recheck/identity go uncalled here).
  return session as unknown as Session;
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
    } as any as SurfaceClientLike;

    const session = fakePumpSession(client);

    // Live holders the pump must clear BEFORE firing onLinkDown — assert that
    // ordering by snapshotting the holder's `.current` from inside the hook.
    const liveClient: LiveSpawnHolder<SurfaceClientLike> = {
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
