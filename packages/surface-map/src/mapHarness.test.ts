/**
 * Mock-entry e2e harness — proves the map's vertical slice end-to-end through
 * `serveSurfaceMap` + `connectSurfaceMap`, with in-process entry surfaces served
 * via `directLink` and wired through a mock `MapRegistry`.
 *
 * Proves: (1) two entries served (no cross-talk), (2) a `useEntry` switch re-keys
 * synchronously, (3) two views of one cell cause ONE upstream subscription
 * (dedup), (4) removing a member ends its live subs TYPED (no error), drops it
 * from `entries`, and reads `not-a-member`, (5) `entries` is the one authority
 * (warming→connected + a fault member reads failed).
 */

import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import type { AnyContractRouter } from "@orpc/contract";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { connectSurfaceMap } from "./client";
import { defineSurfaceMap, type EntryStatus } from "./define";
import {
  type EntryConnectionState,
  type EntrySession,
  type MapRegistry,
  serveSurfaceMap,
} from "./server";

// ── The entry surface (padi-shaped: a read-only `urgency` cell + a collection) ─
const entrySurface = defineSurface({
  cells: {
    urgency: {
      schema: z.object({
        awaiting: z.number(),
        awaitingIds: z.array(z.string()),
      }),
      default: { awaiting: 0, awaitingIds: [] },
      verbs: ["get"], // server-authority, read-only — like padi's real `urgency`
    },
  },
  collections: {
    terminals: {
      keySchema: z.string(),
      schema: z.object({ title: z.string() }),
    },
  },
});

const HostKeySchema = z.string().brand("HostKey");
type HostKey = z.infer<typeof HostKeySchema>;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A mock in-process entry surface, with a spy on how many times its `urgency`
 *  stream is subscribed upstream (the dedup measurement). */
function makeEntry(urgency: { awaiting: number; awaitingIds: string[] }) {
  let urgencyGetCount = 0;
  const { router } = implementSurface(entrySurface, {
    channel: inMemoryChannelByName(),
    cells: { urgency: { store: inMemoryStore(urgency) } },
    collections: {
      terminals: {
        readAll: () => new Map<string, { title: string }>(),
        upsert: () => {},
        remove: () => {},
      },
    },
  });
  const raw = directLink<typeof entrySurface.contract>(router);
  // Count subscriptions to `surface.urgency.get` — one per upstream forward.
  // biome-ignore lint/suspicious/noExplicitAny: opaque oRPC client, spied by string
  const link = new Proxy(raw as any, {
    get(target, prop) {
      if (prop !== "surface") return target[prop];
      const surf = target.surface;
      return new Proxy(surf, {
        get(_s, member) {
          if (member !== "urgency") return surf[member];
          const ns = surf[member];
          return new Proxy(ns, {
            get(_n, verb) {
              if (verb !== "get") return ns[verb];
              return (i: unknown, o: unknown) => {
                urgencyGetCount++;
                return ns.get(i, o);
              };
            },
          });
        },
      });
    },
  });
  return { link, urgencyGetCount: () => urgencyGetCount };
}

/** A mock `MapRegistry` backed by a `Map` of key → session|fault. Honors the two
 *  clauses: `members()`/`has()` reflect a change BEFORE `onChange` fires, from
 *  one consistent view. */
function makeRegistry() {
  const entries = new Map<
    HostKey,
    { session: EntrySession | null; fault?: string }
  >();
  const listeners = new Set<() => void>();
  const fire = () => {
    for (const l of [...listeners]) l();
  };
  const registry: MapRegistry<HostKey> = {
    members: () => [...entries.keys()],
    has: (k) => entries.has(k),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    resolve: (k) => {
      const e = entries.get(k);
      if (!e) return { failed: "unknown key" };
      if (e.fault !== undefined) return { failed: e.fault };
      return e.session as EntrySession;
    },
  };
  return {
    registry,
    addSession(k: HostKey, link: unknown, state: EntryConnectionState) {
      entries.set(k, { session: { link, state } });
      fire();
    },
    addFault(k: HostKey, reason: string) {
      entries.set(k, { session: null, fault: reason });
      fire();
    },
    setState(k: HostKey, state: EntryConnectionState) {
      const e = entries.get(k);
      if (e?.session) {
        entries.set(k, { session: { link: e.session.link, state } });
        fire();
      }
    },
    remove(k: HostKey) {
      // CLAUSE 1 ordering: drop membership FIRST, then fire — so the map's
      // stream-forwarders see `!has(k)` on the notification and end their
      // streams TYPED before this reference is dropped (no socket-error frame).
      entries.delete(k);
      fire();
    },
  };
}

function setup() {
  const map = defineSurfaceMap(HostKeySchema, entrySurface);
  const reg = makeRegistry();
  const served = serveSurfaceMap(map, reg.registry);
  // biome-ignore lint/suspicious/noExplicitAny: served router is a runtime-valid oRPC router; the client re-types via map.entry.
  const mapLink = directLink<AnyContractRouter>(served.router as any);
  const client = connectSurfaceMap(map, mapLink);
  return { map, served, client, ...reg };
}

const A = HostKeySchema.parse("a");
const B = HostKeySchema.parse("b");
const C = HostKeySchema.parse("c");
const D = HostKeySchema.parse("d");

const connected = (clockOffset: number): EntryConnectionState => ({
  kind: "connected",
  clockOffset,
});

describe("surface-map mock-entry e2e harness", () => {
  it("(1) serves two entries with no cross-talk", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 3, awaitingIds: ["x"] }).link,
        connected(100),
      );
      addSession(
        B,
        makeEntry({ awaiting: 7, awaitingIds: ["y", "z"] }).link,
        connected(200),
      );

      const rA = client.entry(A).cells.urgency.use();
      const rB = client.entry(B).cells.urgency.use();
      await settle();

      expect(rA.value()?.awaiting).toBe(3);
      expect(rA.value()?.awaitingIds).toEqual(["x"]);
      expect(rB.value()?.awaiting).toBe(7);
      expect(rB.value()?.awaitingIds).toEqual(["y", "z"]);
      dispose();
    });
  });

  it("(2) useEntry re-keys synchronously on a signal switch", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 3, awaitingIds: [] }).link,
        connected(100),
      );
      addSession(
        B,
        makeEntry({ awaiting: 7, awaitingIds: [] }).link,
        connected(100),
      );

      const [active, setActive] = createSignal<HostKey>(A);
      const view = client.useEntry(active);
      const r = view.cells.urgency.use();
      let awaiting: number | undefined;
      createEffect(() => {
        awaiting = r.value()?.awaiting;
      });

      await settle();
      expect(awaiting).toBe(3); // A

      setActive(B);
      await settle();
      expect(awaiting).toBe(7); // B — re-keyed, no cross-talk
      dispose();
    });
  });

  it("(3) two views of one cell cause ONE upstream subscription (dedup)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      const entryA = makeEntry({ awaiting: 5, awaitingIds: [] });
      addSession(A, entryA.link, connected(0));

      const r1 = client.entry(A).cells.urgency.use();
      const r2 = client.entry(A).cells.urgency.use();
      await settle();

      expect(r1.value()?.awaiting).toBe(5);
      expect(r2.value()?.awaiting).toBe(5);
      // Both views fold to ONE downstream sub → ONE upstream forward.
      expect(entryA.urgencyGetCount()).toBe(1);
      dispose();
    });
  });

  it("(4) removing a member ends its subs TYPED (no error), drops it, reads not-a-member", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, remove } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 9, awaitingIds: [] }).link,
        connected(100),
      );

      const cell = client.entry(A).cells.urgency.use();
      let cellError: Error | undefined;
      let keys: string[] = [];
      let state: EntryStatus | { kind: "not-a-member" } = { kind: "warming" };
      createEffect(() => {
        cellError = cell.error();
      });
      createEffect(() => {
        keys = client.entries.use().keys().map(String);
      });
      createEffect(() => {
        state = client.entry(A).state();
      });

      await settle();
      expect(cell.value()?.awaiting).toBe(9);
      expect(keys).toContain("a");
      expect(state).toEqual({ kind: "connected", clockOffset: 100 });

      remove(A);
      await settle();

      expect(cellError).toBeUndefined(); // TYPED end — no socket-error frame
      expect(keys).not.toContain("a"); // dropped from the one authority
      expect(state).toEqual({ kind: "not-a-member" }); // total existence-as-a-value
      dispose();
    });
  });

  it("(5) entries is the one authority — warming→connected, and a fault reads failed", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, addFault, setState } = setup();

      const view = client.entries.use();
      let stC: EntryStatus | undefined;
      let stD: EntryStatus | undefined;
      createEffect(() => {
        stC = view.byKey(C)?.() as EntryStatus | undefined;
      });
      createEffect(() => {
        stD = view.byKey(D)?.() as EntryStatus | undefined;
      });

      addSession(C, makeEntry({ awaiting: 0, awaitingIds: [] }).link, {
        kind: "connecting",
      });
      await settle();
      expect(stC).toEqual({ kind: "warming" }); // connecting → warming

      setState(C, connected(42));
      await settle();
      expect(stC).toEqual({ kind: "connected", clockOffset: 42 });

      addFault(D, "no drv for arch");
      await settle();
      expect(stD).toEqual({ kind: "failed", reason: "no drv for arch" });
      dispose();
    });
  });
});
