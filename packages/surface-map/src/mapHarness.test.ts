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
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import type { AnyContractRouter } from "@orpc/contract";
import type { createRouterClient } from "@orpc/server";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { connectSurfaceMap, type EntryState, floorOnLiveness } from "./client";
import type { EntryStatus, KeyCodec } from "./define";
import { testMembershipId } from "./testing";
import {
  A,
  B,
  buildTestMap,
  C,
  connected,
  D,
  disconnected,
  entrySurface,
  failed,
  type HostKey,
  HostKeySchema,
  identityCodec,
  liveWhenEntrySurface,
  makeEntry,
  makeLiveWhenEntry,
  makeRegistry,
  settle,
  setup,
  type TestFailure,
} from "./mapHarness.testlib";
import {
  type EntryConnectionState,
  type EntrySession,
  type MapRegistry,
  serveSurfaceMap,
} from "./server";

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
      let state: EntryState = {
        kind: "warming",
        membershipId: testMembershipId(),
      };
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
      // `toMatchObject` — the published arm now also carries an opaque `membershipId`
      // (PR3), asserted for real in the "membership is time" pins below; here we pin the
      // kind + offset the consumer reads, blind to the id.
      expect(state).toMatchObject({ kind: "connected", clockOffset: 100 });

      remove(A);
      await settle();

      expect(cellError).toBeUndefined(); // TYPED end — no socket-error frame
      expect(keys).not.toContain("a"); // dropped from the one authority
      expect(state).toEqual({ kind: "not-a-member" }); // total existence-as-a-value (no id)
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
      expect(stC).toMatchObject({ kind: "warming" }); // connecting → warming

      setState(C, connected(42));
      await settle();
      expect(stC).toMatchObject({ kind: "connected", clockOffset: 42 });

      // Readiness is decoupled from the clock offset (PR3): a connected session whose
      // `system.clockNow` probe hasn't landed carries `clockOffset: null` and still reads
      // CONNECTED end-to-end (server projection → client), never demoted to connecting/warming.
      setState(C, connected(null));
      await settle();
      expect(stC).toMatchObject({ kind: "connected", clockOffset: null });

      addFault(D, { cause: "drv-missing", reason: "no drv for arch" }, []);
      await settle();
      // A structural fault (no live session) publishes the SAME schema-valid domain
      // `failure` a session-backed failed entry does (PR4 — no `"other"` fabrication).
      expect(stD).toMatchObject({
        kind: "failed",
        failure: { cause: "drv-missing", reason: "no drv for arch" },
      });
      dispose();
    });
  });

  it("(5b) disconnected projects on FAILURE-PRESENCE: transient (no failure) -> warming, standing refuse (a failure) -> failed; terminal -> failed (PR4)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, setState } = setup();
      const view = client.entries.use();
      let st: EntryStatus | undefined;
      createEffect(() => {
        st = view.byKey(C)?.() as EntryStatus | undefined;
      });

      addSession(
        C,
        makeEntry({ awaiting: 0, awaitingIds: [] }).link,
        connected(0),
      );
      await settle();
      expect(st).toMatchObject({ kind: "connected", clockOffset: 0 });

      // TRANSIENT reconnect-backoff — the link dropped, the loop is redialing, the
      // classifier reported NO standing failure (absent `failure`). IN MOTION ->
      // WARMING, not a red "failed" chip indistinguishable from a dead host (the P4
      // defect collapsed disconnected onto failed). PR4: the discriminant is
      // failure-PRESENCE now, not a magic "other" sentinel.
      setState(C, disconnected());
      await settle();
      expect(st).toMatchObject({ kind: "warming" });

      // STANDING refuse — a domain `failure` on disconnected (the session holds
      // degraded, redialing can't resolve a foreign supervisor). NOT PROCEEDING
      // WITHOUT INTERVENTION -> FAILED + the failure, so the host-down card renders
      // rather than a lying "connecting" spinner (the step-5 masking bug).
      setState(
        C,
        disconnected({
          failure: {
            cause: "cross-supervisor",
            reason: "another kolu owns this host",
          },
          evidence: [],
        }),
      );
      await settle();
      expect(st).toMatchObject({
        kind: "failed",
        failure: {
          cause: "cross-supervisor",
          reason: "another kolu owns this host",
        },
      });

      // A TERMINAL give-up (the reconnect loop stopped for good) reads failed,
      // carrying its domain failure (a terminal give-up always classifies).
      setState(
        C,
        failed(
          {
            cause: "link-failed",
            reason: "gave up after 5 tries",
          },
          [],
        ),
      );
      await settle();
      expect(st).toMatchObject({
        kind: "failed",
        failure: { cause: "link-failed", reason: "gave up after 5 tries" },
      });
      dispose();
    });
  });

  // (5c) — a terminal `failed` state with NO domain failure is no longer a RUNTIME
  // throw: the `EntryConnectionState.failed` arm now REQUIRES `failure`, so the
  // illegal state is UNCONSTRUCTIBLE at the type. The old `.toThrow(...)` pin moved
  // to a compile-fail in `entryConnectionState.test-d.ts` (a `@ts-expect-error` on a
  // failed arm missing `failure`), the honest home for "this state cannot be spelled".

  it("(6) rpc folds {mapKey,input} to the keyed entry and rejects an absent key", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 11, awaitingIds: ["p"] }).link,
        connected(0),
      );
      addSession(
        B,
        makeEntry({ awaiting: 22, awaitingIds: ["q"] }).link,
        connected(0),
      );

      // `Entry.rpc` is typed `SurfaceClient<ES>["rpc"]` (`unknown` at the generic map —
      // the consumer casts to its own entry contract; here a minimal shape for the pin).
      // A cell `get` is a subscription (resolves to an async iterable); a collection
      // `upsert` is a one-shot procedure (resolves to a value).
      type EntryRpc = {
        surface: {
          urgency: { get: () => Promise<AsyncIterable<{ awaiting: number }>> };
          terminals: {
            upsert: (input: {
              key: string;
              value: { title: string };
            }) => Promise<unknown>;
          };
        };
      };

      // (a) THE FOLD — a raw rpc call through `entry(A)`: the key-injecting link folds
      // `{ mapKey: A }` into the wire input (the consumer passes NO key), and the map
      // server unwraps it and routes to A's entry, so the snapshot is A's urgency, never
      // B's. The SAME envelope fold the `.use()` subs ride, exercised at the procedure
      // client.
      let firstA: { awaiting: number } | undefined;
      const iterA = await (
        client.entry(A).rpc as EntryRpc
      ).surface.urgency.get();
      for await (const item of iterA) {
        firstA = item;
        break;
      }
      expect(firstA?.awaiting).toBe(11); // routed to A by the fold, not B

      // (b) TYPED REJECTION ON AN ABSENT KEY — a one-shot procedure (a collection
      // `upsert`) through a never-a-member key cannot end gracefully like a sub's typed
      // stream-end, so it REJECTS (`MAP_KEY_UNKNOWN`), never silently resolving to a
      // no-op. This is the procedure-client half of the total-existence discipline the
      // subs honor (an absent key is answered, never hung or swallowed).
      await expect(
        (client.entry(D).rpc as EntryRpc).surface.terminals.upsert({
          key: "t1",
          value: { title: "x" },
        }),
      ).rejects.toThrow(/not a member|MAP_KEY_UNKNOWN/);
      dispose();
    });
  });

  it("(7) entries is READ-ONLY — a client mutation is a TYPE error, not a runtime reject", () => {
    const { client } = setup();
    const e = client.entries;
    // `entries` is the ONE membership authority, published by one writer; a consumer must
    // not be able to even EXPRESS a mutation. `ReadOnlyBoundCollection` drops upsert/delete
    // structurally, so these are compile errors (not the old rejects-at-runtime lie-shape).
    // @ts-expect-error — upsert is structurally absent from ReadOnlyBoundCollection.
    const _u: unknown = e.upsert;
    // @ts-expect-error — delete is likewise absent.
    const _d: unknown = e.delete;
    void _u;
    void _d;
    expect(typeof e.use).toBe("function"); // the read path (keys/get) remains
  });

  it("(8) removal DURING the subscribe dial ends TYPED — no stale value for an absent member", async () => {
    // The removal-during-await half of the teardown fix: `forwardStream` installs its
    // membership watcher BEFORE the `await leaf()` dial and re-checks `has()` AFTER it, so a
    // removal that lands WHILE a (delta) member is still dialing ends the stream TYPED,
    // before it can yield a snapshot for a host that is no longer a member. (The other half
    // — a delta member whose upstream REJECTS on the pool's destroy→delete→notify order —
    // additionally needs hostFanout reordered to delete→notify→destroy; tracked separately.)
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: HostKeySchema,
        entry: entrySurface,
        codec: identityCodec,
      });
      // A link whose `urgency.get` DIAL is slow — resolved by hand, modelling a member
      // still provisioning when the host is removed.
      let resolveDial!: (it: AsyncIterable<unknown>) => void;
      const slowLink = {
        surface: {
          urgency: {
            get: () =>
              new Promise<AsyncIterable<unknown>>((res) => {
                resolveDial = res;
              }),
          },
        },
      };
      const entries = new Map<HostKey, EntrySession<"copying", TestFailure>>();
      const listeners = new Set<() => void>();
      const registry: MapRegistry<HostKey, "copying", TestFailure> = {
        members: () => [...entries.keys()],
        has: (k) => entries.has(k),
        subscribe: (cb) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
        resolve: (k) =>
          entries.get(k) ?? {
            kind: "fault",
            failure: { cause: "fault", reason: "unknown" },
            // An unknown key produced no output — `[]` is the honest fact.
            evidence: [],
          },
      };
      entries.set(A, { kind: "session", link: slowLink, state: connected(0) });
      const served = serveSurfaceMap(map, registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);

      const cell = client.entry(A).cells.urgency.use();
      let cellError: Error | undefined;
      createEffect(() => {
        cellError = cell.error();
      });
      await settle(); // forwardStream is now blocked in `await leaf()` (the slow dial)

      // Remove A mid-dial: delete (has → false) + notify. The watcher (installed before the
      // await) fires; the has-recheck (after the dial resolves) ends TYPED before yielding.
      entries.delete(A);
      for (const l of [...listeners]) l();
      resolveDial(
        (async function* () {
          yield { awaiting: 1, awaitingIds: [] }; // the value that must NOT reach the client
        })(),
      );
      await settle();

      expect(cellError).toBeUndefined(); // typed end, not a stub error
      expect(cell.value()).toBeUndefined(); // absent member never received a stale snapshot
      dispose();
    });
  });

  it("(9) the { live } override is unspellable — there is NO 3rd arg; liveness rides only the branded transport", () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: entrySurface,
      codec: identityCodec,
    });
    // Liveness comes ONLY from a branded LiveSignalHandle (its watchdog `live`) or a
    // constant-true in-process directLink. PR3 removed the `siblingKey` param (the slice
    // key derives from `map.name` now), so there is no 3rd argument at all — a raw
    // liveness accessor (the #1564 green-over-dead lie) has nowhere to go.
    const bad = () =>
      connectSurfaceMap(
        map,
        {} as unknown,
        // @ts-expect-error — connectSurfaceMap takes exactly 2 args; there is no 3rd seam.
        { live: () => true },
      );
    expect(bad).toBeDefined();
  });

  it("(10) entry.clock.toLocal reprojects a remote timestamp by the offset — null (NOT identity) with no offset", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, setState } = setup();
      // Subscribe `entries` so the clock's state-fold reads live membership + status.
      client.entries.use();

      // Warming (connecting, no measured offset yet) → toLocal is NULL — the honest
      // pending, never a silent identity that would paint a foreign-clock instant as local.
      addSession(A, makeEntry({ awaiting: 0, awaitingIds: [] }).link, {
        kind: "connecting",
      });
      await settle();
      expect(client.entry(A).clock.toLocal(1_000_000)).toBeNull();

      // Connected, host +45s ahead → remoteMs − 45000, a SANE local instant.
      setState(A, connected(45_000));
      await settle();
      expect(client.entry(A).clock.toLocal(1_045_000)).toBe(1_000_000);

      // Offset 0 (a local host) → identity, but ONLY because the offset is genuinely 0.
      setState(A, connected(0));
      await settle();
      expect(client.entry(A).clock.toLocal(1_234)).toBe(1_234);

      dispose();
    });
  });

  it("(11) remove+READD host-flap during the dial ends the ORIGINAL forward TYPED — a re-add cannot un-orphan the captured session", async () => {
    // The `removed`-latch half of the teardown fix: the dial-reject / recheck / loop guards
    // test whether THIS forward's key LEFT membership (a latch set in the watcher), NOT the
    // live `has()`. So a host flap — remove (destroy S1) then re-add under a NEW session S2
    // while the S1 dial is still in flight — cannot un-orphan this forward (bound to S1): the
    // captured-session dial rejects into a TYPED END, never a raw stub error, even though
    // `has()` is true again from the re-add. (With the old `has()`-gate it would `throw e`.)
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: HostKeySchema,
        entry: entrySurface,
        codec: identityCodec,
      });
      let rejectDial!: (e: Error) => void;
      const slowRejectingLink = {
        surface: {
          urgency: {
            get: () =>
              new Promise<AsyncIterable<unknown>>((_res, rej) => {
                rejectDial = rej;
              }),
          },
        },
      };
      const entries = new Map<HostKey, EntrySession<"copying", TestFailure>>();
      const listeners = new Set<() => void>();
      const registry: MapRegistry<HostKey, "copying", TestFailure> = {
        members: () => [...entries.keys()],
        has: (k) => entries.has(k),
        subscribe: (cb) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
        resolve: (k) =>
          entries.get(k) ?? {
            kind: "fault",
            failure: { cause: "fault", reason: "unknown" },
            // An unknown key produced no output — `[]` is the honest fact.
            evidence: [],
          },
      };
      const fire = () => {
        for (const l of [...listeners]) l();
      };
      entries.set(A, {
        kind: "session",
        link: slowRejectingLink,
        state: connected(0),
      }); // session S1
      const served = serveSurfaceMap(map, registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);

      const cell = client.entry(A).cells.urgency.use();
      let cellError: Error | undefined;
      createEffect(() => {
        cellError = cell.error();
      });
      await settle(); // blocked in the S1 dial

      // Flap: remove A (has → false; the watcher LATCHES removed=true) THEN re-add under a
      // NEW session S2 (has → true again) — both before the S1 dial settles.
      entries.delete(A);
      fire();
      entries.set(A, {
        kind: "session",
        link: makeEntry({ awaiting: 7, awaitingIds: [] }).link,
        state: connected(0),
      }); // session S2
      fire();

      // The captured S1 dial now rejects (its session was destroyed). `has(A)` is TRUE (S2),
      // but THIS forward is orphaned to S1 → the `removed` latch ends it TYPED.
      rejectDial(new Error("session S1 destroyed"));
      await settle();

      expect(cellError).toBeUndefined(); // typed end, NOT the raw "session S1 destroyed" error
      dispose();
    });
  });

  it("(12) connectSurfaceMap REJECTS a raw pre-sliced / unbranded wire link — no green-over-dead door", () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: entrySurface,
      codec: identityCodec,
    });
    // A bare unbranded link (a pre-sliced `scopeSibling` re-wrap, or any non-directLink,
    // non-LiveSignalHandle value) would fall to `resolveTransport`'s by-exclusion
    // constant-`true` and floor chips GREEN over a dead transport (#1564). connectSurfaceMap
    // owns the slicing now, so a pre-sliced link is a misuse — it THROWS. (The in-process
    // `directLink` path stays valid — every other pin's `setup()` exercises it.)
    const bareLink = { surface: { urgency: { get: () => Promise.resolve() } } };
    expect(() => connectSurfaceMap(map, bareLink as unknown)).toThrow(
      /branded parent transport handle|pre-sliced or bare wire link/,
    );
  });

  it("(13) useEntry's reactive re-wrap preserves .sub's nested accessors — .pending/.error survive (no boot TypeError)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 3, awaitingIds: [] }).link,
        connected(0),
      );

      const [active] = createSignal<HostKey>(A);
      const r = client.useEntry(active).cells.urgency.use();

      // `.sub` is a Subscription: an accessor that ALSO carries `.pending`/`.error` accessor
      // PROPERTIES. The reactiveDelegate re-wrap must NOT flatten it to a bare callable —
      // that dropped `.pending`/`.error` and made `savedSessionSub.pending()` (wire.ts) a
      // boot-time TypeError at three real call sites the useEntry-MOCKING unit tests hid.
      expect(typeof r.sub).toBe("function"); // the value accessor itself
      expect(typeof r.sub.pending).toBe("function"); // survived the delegate
      expect(typeof r.sub.error).toBe("function");
      expect(() => r.sub.pending()).not.toThrow();
      expect(() => r.sub.error()).not.toThrow();

      await settle();
      // …and they track the underlying sub: the frame landed → not pending, no error, value 3.
      expect(r.sub.pending()).toBe(false);
      expect(r.sub.error()).toBeUndefined();
      expect(r.sub()?.awaiting).toBe(3);
      dispose();
    });
  });

  it("(14) multi-host membership crash — two `entries` consumers, shared or divergent onError, neither crashes nor drops", async () => {
    // kolu's multi-host wiring has TWO whole-collection consumers of the membership authority
    // `entries`: HostSelectorStrip's chip row and wire.ts's reconcile sub. They mount in NO
    // guaranteed order — the GATED strip can register before wire.ts's setup runs — and the
    // whole-collection dedup slot used to be order-ASYMMETRIC. The `nix run` runtime crash was
    // a BARE strip `.use()` baking `undefined` into the slot FIRST, then a handler sibling
    // THROWING second. The fix is now a per-consumer onError REGISTRY (kolu can keep using ONE
    // shared `onHostMembershipError` reference, or two distinct ones — either way both fire).
    // This is the registration-layer sibling of the unmocked-boot test: gate-ON, both consumers
    // register, the wiring comes up clean — no DOM.
    const onMembershipError = (_err: Error): void => {};

    // (a) THE FIX — both consumers SHARE the handler; strip-FIRST (the crash order) is clean.
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 1, awaitingIds: [] }).link,
        connected(0),
      );
      expect(() => {
        client.entries.use({ onError: onMembershipError }); // strip chip row — registers first
        client.entries.use({ onError: onMembershipError }); // wire.ts reconcile — registers second
      }).not.toThrow();
      await settle();
      dispose();
    });

    // (b) THE TRAP it closes — a DIVERGENT pair (bare strip `.use()` first, then a handler) used
    //     to THROW LOUDLY on the real membership authority (order-asymmetric: handler-first-
    //     then-bare shared fine, the reverse crashed). Per-consumer wiring makes that order
    //     irrelevant: both now just REGISTER, and — proven on the real membership authority
    //     below, not just "didn't throw" — the handler consumer's onError actually FIRES when
    //     `entries` genuinely faults (a resolve failure on a live member's status stream), while
    //     the bare strip consumer (no handler) has nothing to drop.
    await createRoot(async (dispose) => {
      const { registry, addSession, armResolveThrow } = armableRegistry();
      const map = buildTestMap({
        key: HostKeySchema,
        entry: entrySurface,
        codec: identityCodec,
      });
      const served = serveSurfaceMap(map, registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);
      addSession(
        A,
        makeEntry({ awaiting: 0, awaitingIds: [] }).link,
        connected(0),
      );

      const fires: Error[] = [];
      const handler = (e: Error) => fires.push(e);

      client.entries.use(); // strip, BARE (undefined) — registers first
      let view: ReturnType<typeof client.entries.use> | undefined;
      expect(() => {
        view = client.entries.use({ onError: handler }); // registers second, DIVERGENT
      }).not.toThrow();

      await settle();
      // Arm A's next `resolve()` to throw, then open A's per-key status stream (lazily, on the
      // first `byKey` read) — its snapshot computation faults for real, through the SAME
      // whole-collection dedup slot `entries.use()` above shares.
      armResolveThrow(A);
      view?.byKey(A);
      await settle();
      expect(fires.length).toBe(1);
      dispose();
    });
  });

  it("(15) honest cost — a sibling's frame does NOT re-emit an unchanged member (condition-2 equals-gate)", async () => {
    // The republish fires on EVERY registry change (SR9 folds the fine connection onto
    // the entry, so the family fires on every session frame). Without a gate, one
    // member's frame re-emits ALL members — O(M²) across a streaming pool. Count the
    // SERVER's per-key emits on a RAW client, BENEATH the high-level client's own dedup,
    // so this pins the republish gate itself (not the client's).
    await createRoot(async (dispose) => {
      const { served, addSession, setState } = setup();
      // `directLink<AnyContractRouter>` types the client loosely (no `.surface`), so
      // narrow to the one streaming call this test drives.
      const raw = directLink<AnyContractRouter>(
        served.router as Parameters<typeof createRouterClient>[0],
      ) as unknown as {
        surface: {
          entries: {
            get: (
              input: { key: string },
              opts?: { signal?: AbortSignal },
            ) => Promise<AsyncIterable<EntryStatus<TestFailure>>>;
          };
        };
      };
      addSession(
        A,
        makeEntry({ awaiting: 1, awaitingIds: [] }).link,
        connected(100),
      );
      addSession(
        B,
        makeEntry({ awaiting: 1, awaitingIds: [] }).link,
        connected(200),
      );

      // Open A's per-key status stream and drain it in the background, tallying emits.
      const ac = new AbortController();
      const aEmits: EntryStatus<TestFailure>[] = [];
      const stream = (await raw.surface.entries.get(
        { key: "a" },
        { signal: ac.signal },
      )) as AsyncIterable<EntryStatus<TestFailure>>;
      const pump = (async () => {
        try {
          for await (const s of stream) aEmits.push(s);
        } catch {
          // aborted at teardown — expected
        }
      })();
      await settle();
      const snapshot = aEmits.length; // just the initial snapshot yield
      expect(snapshot).toBe(1);

      // A sibling (B) frames twice — A is untouched, so A must NOT re-emit.
      setState(B, connected(201));
      setState(B, connected(202));
      await settle();
      expect(aEmits.length).toBe(snapshot);

      // Re-set A to the SAME published value — equals-gated, still no re-emit.
      setState(A, connected(100));
      await settle();
      expect(aEmits.length).toBe(snapshot);

      // A REAL change to A DOES emit (the gate never swallows a true change).
      setState(A, connected(999));
      await settle();
      expect(aEmits.length).toBe(snapshot + 1);
      expect(
        (aEmits.at(-1) as { clockOffset?: number | null }).clockOffset,
      ).toBe(999);

      ac.abort();
      await pump;
      dispose();
    });
  });

  it("(16) the republish gate compares EVERY published field — an evidence-only change re-emits", async () => {
    // The companion to (15). That test pins the gate's SUPPRESSING half (an unchanged
    // member must not re-emit); this pins the half a hand-enumerated comparison
    // silently breaks — a field the gate was never told about. `evidence` is exactly
    // that field: it joined the `failed` arm after the gate was written, and a fault
    // publishes NO `connection`, so an evidence-only change moves nothing else. With
    // `evidence` missing from the comparison the two statuses below look identical and
    // the new tail is never published — the failure is silent, which is why it is
    // pinned here rather than left to review.
    await createRoot(async (dispose) => {
      const { served, addFault } = setup();
      const raw = directLink<AnyContractRouter>(
        served.router as Parameters<typeof createRouterClient>[0],
      ) as unknown as {
        surface: {
          entries: {
            get: (
              input: { key: string },
              opts?: { signal?: AbortSignal },
            ) => Promise<AsyncIterable<EntryStatus<TestFailure>>>;
          };
        };
      };
      // ONE failure value, reused by reference across both mints — so `failure` is
      // `Object.is`-equal and `evidence` is the only field that moves.
      const failure: TestFailure = { cause: "c", reason: "r" };
      addFault(A, failure, [{ source: "local", line: "first" }]);

      const ac = new AbortController();
      const emits: EntryStatus<TestFailure>[] = [];
      const stream = (await raw.surface.entries.get(
        { key: "a" },
        { signal: ac.signal },
      )) as AsyncIterable<EntryStatus<TestFailure>>;
      const pump = (async () => {
        try {
          for await (const s of stream) emits.push(s);
        } catch {
          // aborted at teardown — expected
        }
      })();
      await settle();
      expect(emits.length).toBe(1);

      // The episode printed one more line. Nothing else about the entry changed.
      addFault(A, failure, [
        { source: "local", line: "first" },
        { source: "remote", line: "second" },
      ]);
      await settle();
      expect(emits.length).toBe(2);
      expect(
        (emits.at(-1) as Extract<EntryStatus<TestFailure>, { kind: "failed" }>)
          .evidence,
      ).toEqual([
        { source: "local", line: "first" },
        { source: "remote", line: "second" },
      ]);

      ac.abort();
      await pump;
      dispose();
    });
  });
});

/** Like {@link makeRegistry}, but `resolve` can be armed to THROW exactly once for a given
 *  key — the one-shot escape hatch to drive a REAL membership-stream fault (as opposed to a
 *  `{failed}` status VALUE, which `addFault` already covers) through `entries`' per-key status
 *  stream, for the divergent-onError-consumers regression test above. */
function armableRegistry() {
  const entries = new Map<HostKey, EntrySession<"copying", TestFailure>>();
  const listeners = new Set<() => void>();
  let throwOnResolve: HostKey | null = null;
  const fire = () => {
    for (const l of [...listeners]) l();
  };
  const registry: MapRegistry<HostKey, "copying", TestFailure> = {
    members: () => [...entries.keys()],
    has: (k) => entries.has(k),
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    resolve: (k) => {
      if (throwOnResolve === k) {
        throwOnResolve = null; // one-shot — never re-arms itself
        throw new Error("membership resolve boom");
      }
      return (
        entries.get(k) ?? {
          kind: "fault",
          failure: { cause: "fault", reason: "unknown key" },
          // An unknown key produced no output — `[]` is the honest fact.
          evidence: [],
        }
      );
    },
  };
  return {
    registry,
    addSession(
      k: HostKey,
      link: unknown,
      state: EntryConnectionState<"copying", TestFailure>,
    ) {
      entries.set(k, { kind: "session", link, state });
      fire();
    },
    armResolveThrow(k: HostKey) {
      throwOnResolve = k;
    },
  };
}

// ── Membership is time, and time is a fact (PR3) ──────────────────────────────
// The opaque, never-reused `membershipId` `serveSurfaceMap` stamps on every add,
// published on every status arm, keyed by every cached client — the fact that makes a
// same-key remove/re-add and an authority restart rebuild subscriptions BY CONSTRUCTION,
// replacing kolu's hand-rolled `createRejoinKeyedSub` generation rearm.
describe("membership is time — opaque membershipId (PR3)", () => {
  /** Read A's currently-published `membershipId` off the `entries` authority. */
  const idReader = (client: ReturnType<typeof setup>["client"]) => {
    let id: string | undefined;
    createEffect(() => {
      id = (
        client.entries.use().byKey(A)?.() as
          | EntryStatus<TestFailure>
          | undefined
      )?.membershipId;
    });
    return () => id;
  };

  it("every published arm carries a membershipId — warming, connected, AND failed", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, addFault, setState } = setup();
      const view = client.entries.use();
      let stA: EntryStatus<TestFailure> | undefined;
      let stB: EntryStatus<TestFailure> | undefined;
      createEffect(() => {
        stA = view.byKey(A)?.() as EntryStatus<TestFailure> | undefined;
      });
      createEffect(() => {
        stB = view.byKey(B)?.() as EntryStatus<TestFailure> | undefined;
      });

      addSession(A, makeEntry({ awaiting: 0, awaitingIds: [] }).link, {
        kind: "connecting",
      }); // → warming
      addFault(B, { cause: "drv-missing", reason: "no drv" }, []); // → failed
      await settle();
      expect(stA?.kind).toBe("warming");
      expect(stA?.membershipId).toEqual(expect.any(String));
      expect(stB?.kind).toBe("failed");
      expect(stB?.membershipId).toEqual(expect.any(String));

      setState(A, connected(0)); // → connected
      await settle();
      expect(stA?.kind).toBe("connected");
      expect(stA?.membershipId).toEqual(expect.any(String));
      dispose();
    });
  });

  it("a same-key remove/re-add mints a DIFFERENT membershipId AND rebuilds the subscription (the createRejoinKeyedSub scenario)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, remove } = setup();
      const entry1 = makeEntry({ awaiting: 1, awaitingIds: [] });
      addSession(A, entry1.link, connected(0));

      // A reactive useEntry sub over A's urgency cell (opened synchronously — `useEntry`
      // needs a live reactive owner). It is the sub that must REBUILD on a same-key re-add
      // — the exact stranding `createRejoinKeyedSub` used to hand-fix.
      const [active] = createSignal<HostKey>(A);
      const cell = client.useEntry(active).cells.urgency.use();
      let awaiting: number | undefined;
      createEffect(() => {
        awaiting = cell.value()?.awaiting;
      });
      const idOf = idReader(client);
      await settle();
      expect(awaiting).toBe(1);
      const id1 = idOf();
      expect(id1).toEqual(expect.any(String));

      // Flap: remove A (its subs typed-end), then re-add under a BRAND-NEW session.
      remove(A);
      await settle();
      const entry2 = makeEntry({ awaiting: 2, awaitingIds: [] });
      addSession(A, entry2.link, connected(0));
      await settle();

      const id2 = idOf();
      expect(id2).toEqual(expect.any(String));
      expect(id2).not.toBe(id1); // never reused — a re-add is a NEW member
      // The REBUILD, proven two ways: the sub now reads the NEW session's value (not
      // stranded at the old 1), and the new session's link got EXACTLY ONE fresh upstream
      // forward — the stale sub was torn down and a genuinely fresh one opened against it.
      expect(awaiting).toBe(2);
      expect(entry2.urgencyGetCount()).toBe(1);
      dispose();
    });
  });

  it("the membershipId is STABLE across a status transition — a mere connected↔warming flip does NOT churn it or rebuild the sub", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, setState } = setup();
      const entry = makeEntry({ awaiting: 7, awaitingIds: [] });
      addSession(A, entry.link, connected(0));

      const [active] = createSignal<HostKey>(A);
      const cell = client.useEntry(active).cells.urgency.use();
      createEffect(() => void cell.value());
      const idOf = idReader(client);
      await settle();
      const id1 = idOf();
      expect(id1).toEqual(expect.any(String));
      // Baseline forward count once connected (a sub opened before its first membership
      // frame re-keys once when the id lands — an on-screen-neutral cold-start detail; we
      // pin the INVARIANT that a status flip adds NO further forwards, not the absolute).
      const forwardsWhenConnected = entry.urgencyGetCount();

      // A transient drop (→ warming) then reconnect (→ connected): the SAME membership
      // throughout — no remove — so the id must not change and the sub must not rebuild
      // (a churned id here would be a spurious teardown storm on every reconnect blip).
      setState(A, disconnected());
      await settle();
      expect(idOf()).toBe(id1);
      setState(A, connected(5));
      await settle();
      expect(idOf()).toBe(id1);
      // No NEW forward across the flip — same membership, same client, no re-key/rebuild.
      expect(entry.urgencyGetCount()).toBe(forwardsWhenConnected);
      dispose();
    });
  });

  it("an authority restart (a fresh serveSurfaceMap over the SAME registry) mints ids NEVER reused from the prior server", async () => {
    // Ids live in the `serveSurfaceMap` instance (an in-process Map), so a restarted
    // map-server can never reuse a prior id BY CONSTRUCTION. Composed with the re-add pin
    // above (the client rebuilds on ANY id change), this is the authority-restart path:
    // the reconnect delivers fresh ids → every cached owner misses → subscriptions rebuild.
    const map = buildTestMap({
      key: HostKeySchema,
      entry: entrySurface,
      codec: identityCodec,
    });
    const reg = makeRegistry();
    reg.addSession(
      A,
      makeEntry({ awaiting: 0, awaitingIds: [] }).link,
      connected(0),
    );

    const readIdFromFreshServer = async (): Promise<string | undefined> => {
      const served = serveSurfaceMap(map, reg.registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);
      let id: string | undefined;
      await createRoot(async (dispose) => {
        const idOf = idReader(client);
        await settle();
        id = idOf();
        dispose();
      });
      served.dispose();
      return id;
    };

    const id1 = await readIdFromFreshServer();
    const id2 = await readIdFromFreshServer();
    expect(id1).toEqual(expect.any(String));
    expect(id2).toEqual(expect.any(String));
    expect(id2).not.toBe(id1); // a restarted authority never re-mints a prior id
  });

  it("a RETAINED entry() sub on the pending client survives a concurrent useEntry pending→real re-key", async () => {
    // The createHostWire / watchByEntry shape: a RETAINED `entry(key)` sub (NOT `useEntry`)
    // opened during the pre-first-frame gap rides the '' PENDING client. When a CONCURRENT
    // `useEntry(key)` on the SAME key re-keys pending→real (its first membership frame lands),
    // `clientFor` must NOT dispose the pending client out from under the retained sub — they
    // route identically by enc, and the retained sub has no keyed root to rebuild it.
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      const entryA = makeEntry({ awaiting: 4, awaitingIds: [] });
      // Add the member, then open BOTH subs SYNCHRONOUSLY — before `settle` propagates the
      // membership frame, so `membershipIdOf(A)` is still undefined and both open on pending.
      addSession(A, entryA.link, connected(0));

      const retained = client.entry(A).cells.urgency.use();
      let retainedAwaiting: number | undefined;
      createEffect(() => {
        retainedAwaiting = retained.value()?.awaiting;
      });

      const [active] = createSignal<HostKey>(A);
      const view = client.useEntry(active).cells.urgency.use();
      createEffect(() => void view.value());

      // The frame lands → useEntry re-keys pending→real and builds the real client.
      await settle();
      expect(retainedAwaiting).toBe(4); // the retained sub survived the re-key

      // A LATER frame must still reach it — proof its upstream forward was not torn down.
      entryA.setUrgency({ awaiting: 9, awaitingIds: [] });
      await settle();
      expect(retainedAwaiting).toBe(9);
      dispose();
    });
  });

  it("a liveWhen cell's standing subscription REBUILDS on a same-key re-add — not stranded by clientFor eviction (F1)", async () => {
    // A `liveWhen` cell (padi's real `connection` cell) opens an EAGER, CLIENT-OWNED
    // standing subscription that `SurfaceClient.dispose()` destroys — a DIFFERENT lifecycle
    // from an ordinary cell. `clientFor` disposes the superseded client on a re-add, so the
    // reactive lens must REBUILD that standing sub against the fresh client. The `urgency`
    // re-add pin can't exercise this (ordinary cells have no standing root); here the health
    // value must follow the NEW session, proving the standing sub was rebuilt, not stranded.
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: HostKeySchema,
        entry: liveWhenEntrySurface,
        codec: identityCodec,
      });
      const reg = makeRegistry();
      const served = serveSurfaceMap(map, reg.registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);

      reg.addSession(A, makeLiveWhenEntry(1).link, connected(0));

      const [active] = createSignal<HostKey>(A);
      const cell = client.useEntry(active).cells.health.use();
      let n: number | undefined;
      createEffect(() => {
        n = (cell.value() as { n: number } | undefined)?.n;
      });
      await settle();
      expect(n).toBe(1);

      // Flap: remove A (its standing liveWhen sub is disposed with the client), then re-add
      // under a NEW session whose `health` reads a DIFFERENT value.
      reg.remove(A);
      await settle();
      reg.addSession(A, makeLiveWhenEntry(2).link, connected(0));
      await settle();

      expect(n).toBe(2); // the standing sub REBUILT against the new session — not stranded at 1
      dispose();
    });
  });
});

// The liveness floor `state()`/foldState applies (D3): a per-key chip must never paint
// green over a dead map transport. The dead-link branch is unreachable through the harness
// (a `directLink` is constant-live and a `LiveSignalHandle` is un-forgeable), so the floor
// is extracted PURE (`floorOnLiveness`) and pinned here — foldState routes every status
// through it with the resolved transport `live()`, so this IS the state() decision.
describe("floorOnLiveness — the per-key liveness floor (#1568)", () => {
  it("downgrades a server-published 'connected' to 'warming' when our link is dead — membershipId preserved, fine word dropped (PR3)", () => {
    // The D3 defect: state() published `connected` while `live() === false`, painting a
    // green chip over a transport that can no longer deliver a demotion. Floored → warming.
    // The floor is about LIVENESS, not identity: the entry's opaque `membershipId` rides
    // through the demotion untouched, so the warming is still the SAME membership. The fine
    // `connection` word is just as stale over a dead link, so it is dropped to undefined.
    expect(
      floorOnLiveness(
        {
          kind: "connected",
          membershipId: testMembershipId("m1"),
          clockOffset: 42,
          connection: { phase: "connected" },
        },
        false,
      ),
    ).toEqual({
      kind: "warming",
      membershipId: testMembershipId("m1"),
    });
  });

  it("passes 'connected' through UNTOUCHED when the link is live (offset + membershipId + connection preserved)", () => {
    expect(
      floorOnLiveness(
        {
          kind: "connected",
          membershipId: testMembershipId("m1"),
          clockOffset: 42,
          connection: { phase: "connected" },
        },
        true,
      ),
    ).toEqual({
      kind: "connected",
      membershipId: testMembershipId("m1"),
      clockOffset: 42,
      connection: { phase: "connected" },
    });
  });

  it("drops the fine `connection` word on a NON-connected arm when the link is dead (subsumes the old connectionFloor)", () => {
    // The fine per-entry connection word (the connect overlay's narration) is floored by the
    // SAME liveness decision as the dot: a `warming` arm frozen at `provisioning` over a
    // dead link keeps narrating a build that is no longer live, so the word is dropped to
    // undefined — the one floor every consumer inherits, replacing the client's separate
    // `floorConnectionInfo`. A live link is a no-op and carries the word through.
    expect(
      floorOnLiveness(
        {
          kind: "warming",
          membershipId: testMembershipId("m1"),
          connection: { phase: "provisioning" },
        },
        false,
      ),
    ).toEqual({
      kind: "warming",
      membershipId: testMembershipId("m1"),
    });
    expect(
      floorOnLiveness(
        {
          kind: "warming",
          membershipId: testMembershipId("m1"),
          connection: { phase: "provisioning" },
        },
        true,
      ),
    ).toEqual({
      kind: "warming",
      membershipId: testMembershipId("m1"),
      connection: { phase: "provisioning" },
    });
  });

  it("keeps a failed arm's `failure` AND its `evidence` over a DEAD link (juspay/kolu#2007)", () => {
    // THE property the whole evidence design exists for. The failure record and its
    // evidence are one post-mortem value pinned at classification, so the liveness floor
    // — which exists to stop a STALE LIVE view from narrating work that is no longer
    // happening — has nothing to floor about them. The arm carries no `connection` at
    // all, so there is not even a live field for a dead link to strand the tail behind:
    // before this, the retained tail rode `connection`, and a dead browser link left the
    // card showing a reason with its evidence silently dropped.
    const evidence = [
      { source: "local" as const, line: "nix build …" },
      { source: "remote" as const, line: "error: attribute 'foo' missing" },
    ];
    const floored = floorOnLiveness(
      {
        kind: "failed",
        membershipId: testMembershipId("m1"),
        failure: { cause: "x", reason: "boom" },
        evidence,
      },
      false,
    );
    expect(floored).toEqual({
      kind: "failed",
      membershipId: testMembershipId("m1"),
      failure: { cause: "x", reason: "boom" },
      evidence,
    });
    // Not merely equal — the SAME tail, not a rebuilt copy. The floor passes the record
    // through whole, so nothing downstream can be handed a re-wrapped/truncated variant.
    expect((floored as Extract<EntryStatus, { kind: "failed" }>).evidence).toBe(
      evidence,
    );
  });

  it("never fabricates OR demotes an honest status — failed/warming/not-a-member pass through regardless of live", () => {
    for (const live of [true, false]) {
      expect(
        floorOnLiveness(
          {
            kind: "failed",
            membershipId: testMembershipId("m1"),
            failure: { cause: "x", reason: "boom" },
            evidence: [],
          },
          live,
        ),
      ).toEqual({
        kind: "failed",
        membershipId: testMembershipId("m1"),
        failure: { cause: "x", reason: "boom" },
        evidence: [],
      });
      expect(
        floorOnLiveness(
          { kind: "warming", membershipId: testMembershipId("m1") },
          live,
        ),
      ).toEqual({
        kind: "warming",
        membershipId: testMembershipId("m1"),
      });
      expect(floorOnLiveness({ kind: "not-a-member" }, live)).toEqual({
        kind: "not-a-member",
      });
    }
  });
});

// ── A member name shared by a CELL and a PROCEDURE namespace ──────────────────
// padi's real `session` is a CELL {get, test__set} AND a procedure namespace
// {restore, import, forfeit}. `entryMemberVerbs` emits it TWICE (primitives first,
// procedures last), so a reset-not-merge router build (`inner[member] = {}`) would
// DROP the cell's `get` handler when the procedures pass ran second — `session/get`
// would 404 on every boot, breaking session-restore (the mocked-surface blind spot:
// the other map test surfaces have zero procedures). This pins the accumulating merge.
describe("serveSurfaceMap — a member shared by a cell AND a procedure namespace", () => {
  const collisionSurface = defineSurface({
    cells: {
      session: {
        schema: z.object({ n: z.number() }),
        default: { n: 0 },
        verbs: ["get"], // the CELL verb — clobbered by the bug
      },
    },
    procedures: {
      session: {
        ping: { input: z.object({ echo: z.string() }), output: z.string() },
      },
    },
  });

  it("serves BOTH the cell verb (session/get) and the procedure verb (session/ping) — neither clobbered", async () => {
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: HostKeySchema,
        entry: collisionSurface,
        codec: identityCodec,
      });
      const reg = makeRegistry();
      const { router } = implementSurface(collisionSurface, {
        cells: { session: { store: inMemoryStore({ n: 7 }) } },
        procedures: {
          session: { ping: ({ input }) => input.echo },
        },
      });
      const entryLink = directLink<typeof collisionSurface.contract>(
        router as never,
      );
      const served = serveSurfaceMap(map, reg.registry);
      const mapLink = directLink<AnyContractRouter>(
        // biome-ignore lint/suspicious/noExplicitAny: served router re-typed by the client via map.entry
        served.router as any,
      );
      const client = connectSurfaceMap(map, mapLink);
      reg.addSession(A, entryLink, connected(0));

      // (a) the CELL verb resolves — session/get streams the served store value.
      //     Under the bug this route was clobbered, so the sub 404'd and value()
      //     never left the default { n: 0 }.
      const cell = client.entry(A).cells.session.use();
      await settle();
      expect(cell.value()).toEqual({ n: 7 });

      // (b) the PROCEDURE verb resolves — session/ping still routes (folds {mapKey}).
      // biome-ignore lint/suspicious/noExplicitAny: Entry.rpc is `unknown` at the generic map
      const rpc = client.entry(A).rpc as any;
      expect(await rpc.surface.session.ping({ echo: "pong" })).toBe("pong");

      dispose();
    });
  });
});

// ── useEntry(...).streams.<s>.use(...) must be a CALLABLE Subscription ─────────
// `Entry.streams` is typed as `SurfaceClient<ES>["streams"]`, whose `.use()` returns
// a `Subscription<T>` DIRECTLY (unlike cells/collections, whose `.use()` result is a
// plain object with a nested `.sub`). `makeReactiveEntry`'s `reactiveDelegate` used to
// wrap every `.use()` result the same way (a Proxy over non-callable `{}`), so reading
// a stream through `useEntry` threw `TypeError: ... is not a function` on the very
// first read — the primary read path the type promises.
const streamEntrySurface = defineSurface({
  streams: {
    ping: { inputSchema: z.object({}), outputSchema: z.number() },
  },
});

/** A mock in-process entry surface whose `ping` stream yields ONE value then
 *  completes (typed end) — enough to prove the delegate is callable and tracks
 *  the underlying subscription. */
function makeStreamEntry(value: number) {
  const { router } = implementSurface(streamEntrySurface, {
    streams: {
      ping: {
        source: () =>
          (async function* () {
            yield value;
          })(),
      },
    },
  });
  return {
    link: directLink<typeof streamEntrySurface.contract>(router as never),
  };
}

describe("useEntry(...).streams.<s>.use(...) — a CALLABLE Subscription, not a non-callable proxy", () => {
  it("returns a Subscription that reads as a function, with .pending/.error intact — no boot TypeError", async () => {
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: HostKeySchema,
        entry: streamEntrySurface,
        codec: identityCodec,
      });
      const reg = makeRegistry();
      const served = serveSurfaceMap(map, reg.registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);
      reg.addSession(A, makeStreamEntry(42).link, connected(0));

      const [active] = createSignal<HostKey>(A);
      const sub = client.useEntry(active).streams.ping.use(() => ({}));

      // The bug: `sub` was a Proxy over non-callable `{}` — calling it threw a
      // TypeError despite `BoundStream.use()` (the type `Entry.streams` Picks)
      // promising a callable `Subscription<T>` as its primary read path.
      expect(typeof sub).toBe("function");
      expect(() => sub()).not.toThrow();
      expect(typeof sub.pending).toBe("function");
      expect(typeof sub.error).toBe("function");

      await settle();
      expect(sub.pending()).toBe(false);
      expect(sub.error()).toBeUndefined();
      expect(sub()).toBe(42);
      dispose();
    });
  });
});

// ── useEntry key identity — encode-keyed, not object-reference-keyed ───────────
// The priority finding: `useEntry`'s swap-root (`createKeyedRoot`, keyed by `mapArray`'s
// `===`) used to re-key whenever the accessor's key VALUE was replaced by a new object,
// even one that encodes to the SAME wire string — e.g. clicking the already-active host
// chip, whose `props.host` is a FRESH zod-decoded object each membership read. A plain
// string key (the harness's `identityCodec` above) can't reproduce this: JS strings
// compare by VALUE, so `"a" === "a"` regardless of how each was minted. kolu's real
// `HostKey` is an OBJECT (a discriminated sum) — this describe block uses an
// object-shaped key + a non-identity codec to reproduce the same reference trap.
describe("useEntry key identity — encode-keyed, not object-reference-keyed", () => {
  interface ObjKey {
    kind: "host";
    name: string;
  }
  const ObjKeySchema = z.object({
    kind: z.literal("host"),
    name: z.string(),
  }) satisfies z.ZodType<ObjKey>;
  const objCodec: KeyCodec<ObjKey> = {
    encode: (k) => k.name,
    decode: (s) => ({ kind: "host", name: s }),
  };
  // A FRESH decode always mints a brand-new object — the same shape zod's own
  // `.parse` does for kolu's real `HostKey` even on an already-valid input.
  const freshA = (): ObjKey => ObjKeySchema.parse({ kind: "host", name: "a" });

  function objRegistry() {
    const entries = new Map<
      string,
      {
        kind: "session";
        link: unknown;
        state: EntryConnectionState<"copying", TestFailure>;
      }
    >();
    const listeners = new Set<() => void>();
    const fire = () => {
      for (const l of [...listeners]) l();
    };
    const registry: MapRegistry<ObjKey, "copying", TestFailure> = {
      members: () =>
        [...entries.keys()].map((name) => ({ kind: "host", name })),
      has: (k) => entries.has(k.name),
      subscribe: (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
      resolve: (k) =>
        entries.get(k.name) ?? {
          kind: "fault",
          failure: { cause: "fault", reason: "unknown" },
          // An unknown key produced no output — `[]` is the honest fact.
          evidence: [],
        },
    };
    return {
      registry,
      addSession(
        k: ObjKey,
        link: unknown,
        state: EntryConnectionState<"copying", TestFailure>,
      ) {
        entries.set(k.name, { kind: "session", link, state });
        fire();
      },
    };
  }

  it("a same-key new-reference accessor write does NOT re-key the swap-root — no pending flash, no re-open", async () => {
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: ObjKeySchema,
        entry: streamEntrySurface,
        codec: objCodec,
      });
      const { registry, addSession } = objRegistry();
      addSession(freshA(), makeStreamEntry(9).link, connected(0));
      const served = serveSurfaceMap(map, registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);

      const [active, setActive] = createSignal<ObjKey>(freshA());
      // A stream's `.use()` is PER-CONSUMER, never deduped through the client-lifetime
      // cache cells/collections share — so, unlike a cell, a genuine re-key here is
      // observable synchronously (no grace-period warm-reuse to mask it).
      const sub = client.useEntry(active).streams.ping.use(() => ({}));
      await settle();
      expect(sub()).toBe(9);
      expect(sub.pending()).toBe(false);

      const anotherA = freshA();
      expect(anotherA).not.toBe(active()); // a genuinely NEW reference
      setActive(anotherA);

      // No `await settle()` — `createKeyedRoot`'s disposal is SYNCHRONOUS (an eager
      // `createRenderEffect`), so a re-key would already have reset `pending`/the value
      // here, before any microtask runs.
      expect(sub.pending()).toBe(false); // no flash to pending
      expect(sub()).toBe(9); // no stale-then-reset gap

      dispose();
    });
  });

  it("entries.use().keys() returns REFERENTIALLY-STABLE key objects across calls when membership is unchanged", async () => {
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: ObjKeySchema,
        entry: streamEntrySurface,
        codec: objCodec,
      });
      const { registry, addSession } = objRegistry();
      addSession(freshA(), makeStreamEntry(0).link, connected(0));
      const served = serveSurfaceMap(map, registry);
      const mapLink = directLink<AnyContractRouter>(served.router as never);
      const client = connectSurfaceMap(map, mapLink);

      const view = client.entries.use();
      await settle();
      const keys1 = view.keys();
      const keys2 = view.keys();
      expect(keys1).toHaveLength(1);
      // SAME reference, not just deep-equal — a reference-keyed `<For>` (kolu's
      // HostSelectorStrip) reconciles only a genuinely changed row, not every row on
      // every read.
      expect(keys1[0]).toBe(keys2[0]);
      dispose();
    });
  });
});

// ── The wire key must be its own canonical encoding ────────────────────────────
describe("serveSurfaceMap — the wire key must be its own canonical encoding", () => {
  it("rejects a non-canonical wire key instead of silently splitting subscribe/publish onto two channels", async () => {
    // A LENIENT codec — `decode` case-folds, but `encode` is the identity of the
    // already-lowercase form — accepts MORE than one wire spelling for one member.
    // "A" decodes to the SAME member as "a" (`decode("A") === decode("a") === "a"`),
    // but "A" is NOT its own canonical encoding (`encode("a") === "a" !== "A"`) — the
    // exact split-channel trap: `entries.get` would subscribe on the RAW "A" while
    // the republish loop always publishes on the canonical "a".
    const lenientCodec: KeyCodec<HostKey> = {
      encode: (k) => k,
      decode: (s) => s.toLowerCase() as HostKey,
    };
    const map = buildTestMap({
      key: HostKeySchema,
      entry: entrySurface,
      codec: lenientCodec,
    });
    const reg = makeRegistry();
    reg.addSession(
      A,
      makeEntry({ awaiting: 0, awaitingIds: [] }).link,
      connected(0),
    ); // registers the CANONICAL member "a"
    const served = serveSurfaceMap(map, reg.registry);
    const mapLink = directLink<AnyContractRouter>(served.router as never) as {
      surface: {
        entries: {
          get: (
            input: { key: string },
            opts: unknown,
          ) => Promise<AsyncIterable<unknown>>;
        };
      };
    };

    await expect(
      (async () => {
        const upstream = await mapLink.surface.entries.get({ key: "A" }, {});
        for await (const _ of upstream) break;
      })(),
    ).rejects.toThrow(/canonical/i);
  });
});
