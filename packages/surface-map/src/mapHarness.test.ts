/**
 * Mock-entry e2e harness — proves the map's vertical slice end-to-end through
 * `serveSurfaceMap` + `connectSurfaceMap`, with in-process entry surfaces served
 * via `directDispatch` and wired through a mock `MapRegistry`.
 *
 * Proves: (1) two entries served (no cross-talk), (2) a `useEntry` switch re-keys
 * synchronously, (3) two views of one cell cause ONE upstream subscription
 * (dedup), (4) removing a member ends its live subs TYPED (no error), drops it
 * from `entries`, and reads `not-a-member`, (5) `entries` is the one authority
 * (warming→connected + a fault member reads failed).
 */

import { defineSurface, surfaceTag } from "@kolu/surface/define";
import { MapKeyUnknown } from "@kolu/surface/errors";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { runStreamScoped } from "@kolu/surface/solid";
import { Effect, Schema, Stream } from "effect";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { connectSurfaceMap, type EntryState, floorOnLiveness } from "./client";
import type { EntryStatus, KeyCodec } from "./define";
import { fold } from "./envelope";
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
import { testMembershipId } from "./testing";

/** The map's own membership tags (the map is nameless in this harness, so it serves
 *  at the transport root). Minted through the tag algebra, never spelled by hand. */
const ENTRIES_GET_TAG = surfaceTag("surface/", "entries", "get");
/** The entry surface's `terminals.upsert` tag, folded onto the map's own prefix (which
 *  is the standalone prefix here). */
const TERMINALS_UPSERT_TAG = surfaceTag("surface/", "terminals", "upsert");

/** Drain a raw per-key membership stream in the background, tallying emits. Returns
 *  the tally and the stopper — the tests' successor of the old
 *  `AbortController` + `for await` pump (cancellation is fiber interruption now). */
function drainStatuses(dispatch: SurfaceDispatch, key: string) {
  const emits: Array<EntryStatus<TestFailure>> = [];
  const stop = runStreamScoped(
    dispatch.stream(ENTRIES_GET_TAG, { key }) as Stream.Stream<
      EntryStatus<TestFailure>,
      unknown
    >,
    {
      onFrame: (s) => emits.push(s),
      onEnd: () => {},
      onFailure: () => {},
    },
  );
  return { emits, stop };
}

describe("surface-map mock-entry e2e harness", () => {
  it("(1) serves two entries with no cross-talk", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 3, awaitingIds: ["x"] }).dispatch,
        connected(100),
      );
      addSession(
        B,
        makeEntry({ awaiting: 7, awaitingIds: ["y", "z"] }).dispatch,
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
        makeEntry({ awaiting: 3, awaitingIds: [] }).dispatch,
        connected(100),
      );
      addSession(
        B,
        makeEntry({ awaiting: 7, awaitingIds: [] }).dispatch,
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
      addSession(A, entryA.dispatch, connected(0));

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
        makeEntry({ awaiting: 9, awaitingIds: [] }).dispatch,
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

      expect(cellError).toBeUndefined(); // TYPED end — no error frame
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

      addSession(C, makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch, {
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

      addFault(D, { cause: "drv-missing", reason: "no drv for arch" });
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
        makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
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

  it("(6) the face folds {mapKey,input} to the keyed entry and rejects an absent key", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, mapDispatch } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 11, awaitingIds: ["p"] }).dispatch,
        connected(0),
      );
      addSession(
        B,
        makeEntry({ awaiting: 22, awaitingIds: ["q"] }).dispatch,
        connected(0),
      );

      // (a) THE FOLD — a raw member read through `entry(A).rpc`: the key-injecting
      // DISPATCH folds `{ mapKey: A }` into the payload (the consumer passes NO key),
      // and the map server unwraps it and routes to A's entry, so the snapshot is A's
      // urgency, never B's. The SAME envelope fold the `.use()` subs ride, exercised
      // at the addressing face.
      // Narrowed PER MEMBER, not by re-typing the whole face: `SurfaceFace` is
      // deliberately structural (per-member precision lives in the spec-derived
      // bound faces), so the honest cast is on the one ref this test calls.
      const urgencyGet = client.entry(A).rpc.surface.urgency
        ?.get as () => Stream.Stream<{ awaiting: number }, unknown>;
      const stream = urgencyGet();
      const firstA = await Effect.runPromise(
        Stream.runCollect(Stream.take(stream, 1)),
      );
      expect(firstA[0]?.awaiting).toBe(11); // routed to A by the fold, not B

      // (b) TYPED REJECTION ON AN ABSENT KEY — a one-shot call (a collection `upsert`)
      // through a never-a-member key cannot end gracefully like a sub's typed
      // stream-end, so it FAILS with the declared `MapKeyUnknown` (D4), never silently
      // resolving to a no-op. This is the procedure half of the total-existence
      // discipline the subs honor (an absent key is answered, never hung or swallowed).
      // Driven at the map's own wire tag with the envelope the face would have folded.
      const rejection = await Effect.runPromise(
        Effect.flip(
          mapDispatch.unary(
            TERMINALS_UPSERT_TAG,
            fold("d", { key: "t1", value: { title: "x" } }),
          ),
        ),
      );
      expect(rejection).toBeInstanceOf(MapKeyUnknown);
      expect(rejection).toMatchObject({ _tag: "MapKeyUnknown", mapKey: "d" });
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

  it("(8) removal DURING the subscribe ends TYPED — no stale value for an absent member", async () => {
    // The removal-during-subscribe half of the teardown fix: `forwardStream` acquires
    // its membership watcher BEFORE the upstream stream is subscribed, and latches
    // `removed`, so a removal that lands WHILE a (delta) member's upstream is still
    // opening ends the stream TYPED, before it can yield a snapshot for a host that is
    // no longer a member.
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: HostKeySchema,
        entry: entrySurface,
        codec: identityCodec,
      });
      // An entry dispatch whose `urgency.get` stream never emits until released by
      // hand — modelling a member still provisioning when the host is removed.
      let release!: (value: {
        awaiting: number;
        awaitingIds: string[];
      }) => void;
      const pending = new Promise<{
        awaiting: number;
        awaitingIds: string[];
      }>((res) => {
        release = res;
      });
      const slowDispatch: SurfaceDispatch = {
        unary: () => Effect.never,
        stream: () => Stream.fromEffect(Effect.promise(() => pending)),
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
          },
      };
      entries.set(A, {
        kind: "session",
        dispatch: slowDispatch,
        state: connected(0),
      });
      const served = serveSurfaceMap(map, registry);
      const client = connectSurfaceMap(map, directDispatch(served));

      const cell = client.entry(A).cells.urgency.use();
      let cellError: Error | undefined;
      createEffect(() => {
        cellError = cell.error();
      });
      await settle(); // forwardStream is now parked on the slow upstream

      // Remove A mid-flight: delete (has → false) + notify. The watcher (acquired
      // before the upstream subscribe) latches `removed` and interrupts the stream.
      entries.delete(A);
      for (const l of [...listeners]) l();
      release({ awaiting: 1, awaitingIds: [] }); // the value that must NOT reach the client
      await settle();

      expect(cellError).toBeUndefined(); // typed end, not an error frame
      expect(cell.value()).toBeUndefined(); // absent member never received a stale snapshot
      served.dispose();
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
    // constant-true in-process directDispatch. PR3 removed the `siblingKey` param (the
    // tag scope derives from `map.name` now), so the 3rd argument is options-only — a
    // raw liveness accessor (the #1564 green-over-dead lie) has nowhere to go.
    const bad = () =>
      connectSurfaceMap(map, {} as unknown, {
        // @ts-expect-error — the options bag carries only `onClientError`; there is no
        // `{ live }` seam to smuggle a half-open-blind accessor through.
        live: () => true,
      });
    expect(bad).toBeDefined();
  });

  it("(10) entry.clock.toLocal reprojects a remote timestamp by the offset — null (NOT identity) with no offset", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, setState } = setup();
      // Subscribe `entries` so the clock's state-fold reads live membership + status.
      client.entries.use();

      // Warming (connecting, no measured offset yet) → toLocal is NULL — the honest
      // pending, never a silent identity that would paint a foreign-clock instant as local.
      addSession(A, makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch, {
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

  it("(11) remove+READD host-flap during the subscribe ends the ORIGINAL forward TYPED — a re-add cannot un-orphan the captured session", async () => {
    // The `removed`-latch half of the teardown fix: the upstream-failure and
    // interrupt guards test whether THIS forward's key LEFT membership (a latch set in
    // the watcher), NOT the live `has()`. So a host flap — remove (destroy S1) then
    // re-add under a NEW session S2 while the S1 upstream is still opening — cannot
    // un-orphan this forward (bound to S1): the captured session's failure becomes a
    // TYPED END, never a raw error frame, even though `has()` is true again from the
    // re-add. (With a live `has()` gate it would propagate the failure.)
    await createRoot(async (dispose) => {
      const map = buildTestMap({
        key: HostKeySchema,
        entry: entrySurface,
        codec: identityCodec,
      });
      let rejectUpstream!: (e: Error) => void;
      const pending = new Promise<never>((_res, rej) => {
        rejectUpstream = rej;
      });
      const failingDispatch: SurfaceDispatch = {
        unary: () => Effect.never,
        stream: () =>
          Stream.fromEffect(
            Effect.tryPromise({
              try: () => pending,
              catch: (e) => e,
            }),
          ),
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
          },
      };
      const fire = () => {
        for (const l of [...listeners]) l();
      };
      entries.set(A, {
        kind: "session",
        dispatch: failingDispatch,
        state: connected(0),
      }); // session S1
      const served = serveSurfaceMap(map, registry);
      const client = connectSurfaceMap(map, directDispatch(served));

      const cell = client.entry(A).cells.urgency.use();
      let cellError: Error | undefined;
      createEffect(() => {
        cellError = cell.error();
      });
      await settle(); // parked on the S1 upstream

      // Flap: remove A (has → false; the watcher LATCHES removed=true) THEN re-add under a
      // NEW session S2 (has → true again) — both before the S1 upstream settles.
      entries.delete(A);
      fire();
      entries.set(A, {
        kind: "session",
        dispatch: makeEntry({ awaiting: 7, awaitingIds: [] }).dispatch,
        state: connected(0),
      }); // session S2
      fire();

      // The captured S1 upstream now fails (its session was destroyed). `has(A)` is TRUE
      // (S2), but THIS forward is orphaned to S1 → the `removed` latch ends it TYPED.
      rejectUpstream(new Error("session S1 destroyed"));
      await settle();

      expect(cellError).toBeUndefined(); // typed end, NOT the raw "session S1 destroyed" error
      served.dispose();
      dispose();
    });
  });

  it("(12) connectSurfaceMap REJECTS a raw unbranded wire dispatch — no green-over-dead door", () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: entrySurface,
      codec: identityCodec,
    });
    // A bare unbranded dispatch (any non-directDispatch, non-LiveSignalHandle value)
    // would fall to `resolveTransport`'s by-exclusion constant-`true` and floor chips
    // GREEN over a dead transport (#1564). connectSurfaceMap owns the tag scoping now,
    // so a hand-rolled dispatch is a misuse — it THROWS. (The in-process
    // `directDispatch` path stays valid — every other pin's `setup()` exercises it.)
    const bare: SurfaceDispatch = {
      unary: () => Effect.never,
      stream: () => Stream.empty,
    };
    expect(() => connectSurfaceMap(map, bare)).toThrow(
      /branded parent transport handle|pre-sliced or bare wire link/,
    );
  });

  it("(13) useEntry's reactive re-wrap preserves .sub's nested accessors — .pending/.error survive (no boot TypeError)", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 3, awaitingIds: [] }).dispatch,
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
        makeEntry({ awaiting: 1, awaitingIds: [] }).dispatch,
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
      const client = connectSurfaceMap(map, directDispatch(served));
      addSession(
        A,
        makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
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
      served.dispose();
      dispose();
    });
  });

  it("(15) honest cost — a sibling's frame does NOT re-emit an unchanged member (condition-2 equals-gate)", async () => {
    // The republish fires on EVERY registry change (SR9 folds the fine connection onto
    // the entry, so the family fires on every session frame). Without a gate, one
    // member's frame re-emits ALL members — O(M²) across a streaming pool. Count the
    // SERVER's per-key emits on a RAW dispatch, BENEATH the high-level client's own
    // dedup, so this pins the republish gate itself (not the client's).
    await createRoot(async (dispose) => {
      const { mapDispatch, addSession, setState } = setup();
      addSession(
        A,
        makeEntry({ awaiting: 1, awaitingIds: [] }).dispatch,
        connected(100),
      );
      addSession(
        B,
        makeEntry({ awaiting: 1, awaitingIds: [] }).dispatch,
        connected(200),
      );

      const { emits, stop } = drainStatuses(mapDispatch, "a");
      await settle();
      const snapshot = emits.length; // just the initial snapshot yield
      expect(snapshot).toBe(1);

      // A sibling (B) frames twice — A is untouched, so A must NOT re-emit.
      setState(B, connected(201));
      setState(B, connected(202));
      await settle();
      expect(emits.length).toBe(snapshot);

      // Re-set A to the SAME published value — equals-gated, still no re-emit.
      setState(A, connected(100));
      await settle();
      expect(emits.length).toBe(snapshot);

      // A REAL change to A DOES emit (the gate never swallows a true change).
      setState(A, connected(999));
      await settle();
      expect(emits.length).toBe(snapshot + 1);
      expect(
        (emits.at(-1) as { clockOffset?: number | null }).clockOffset,
      ).toBe(999);

      stop();
      dispose();
    });
  });

  it("(16) the republish gate compares EVERY published field — an evidence-only change re-emits", async () => {
    // The companion to (15). That test pins the gate's SUPPRESSING half (an unchanged
    // member must not re-emit); this pins the half a hand-enumerated comparison
    // silently breaks — a field the gate was never told about. `evidence` is exactly
    // that field: it joined the `failed` arm after the gate was written. With
    // `evidence` missing from the comparison the two statuses below look identical and
    // the new tail is never published — the failure is silent, which is why it is
    // pinned here rather than left to review.
    //
    // Driven through a SESSION-backed `failed` entry whose retained tail GREW — the
    // shape production actually produces (`serveHostMap` stapling `down.log` at the
    // classification seam). A structural fault has no session and therefore no tail to
    // grow, so it cannot vehicle this test.
    await createRoot(async (dispose) => {
      const { mapDispatch, addSession, setState } = setup();
      // ONE failure value, reused across both frames, so `evidence` is the only field
      // that moves.
      const failure: TestFailure = { cause: "c", reason: "r" };
      addSession(
        A,
        makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
        connected(0),
      );
      setState(A, failed(failure, [{ source: "local", line: "first" }]));

      const { emits, stop } = drainStatuses(mapDispatch, "a");
      await settle();
      expect(emits.length).toBe(1);

      // The episode printed one more line. Nothing else about the entry changed.
      setState(
        A,
        failed(failure, [
          { source: "local", line: "first" },
          { source: "remote", line: "second" },
        ]),
      );
      await settle();
      expect(emits.length).toBe(2);
      expect(
        (emits.at(-1) as Extract<EntryStatus<TestFailure>, { kind: "failed" }>)
          .evidence,
      ).toEqual([
        { source: "local", line: "first" },
        { source: "remote", line: "second" },
      ]);

      stop();
      dispose();
    });
  });

  it("(17) the gate compares published fields STRUCTURALLY — a fresh-but-equal failure does NOT re-emit", async () => {
    // The guarantee the gate owes every `MapRegistry`, not just the ones that happen to
    // memoise. A domain classifier naturally mints a FRESH `failure` literal per resolve
    // (kolu's `padiFailureOf`, drishti's, the fleet-top example's) — there is nothing in
    // the `MapRegistry` type, and no test outside this one, that would tell such a
    // producer its literals must be reference-stable. If the gate compared by reference,
    // every one of them would re-emit every failed member on every sibling's frame
    // (O(M²) across a pool) with no compile error and no signal. So the gate compares
    // STRUCTURALLY and the producer owes nothing: an equal value, however freshly built,
    // is quiet. (Test (16) is the other direction — a genuinely changed field re-emits.)
    await createRoot(async (dispose) => {
      const { mapDispatch, addSession, setState } = setup();
      // Every value here is minted anew per frame — nothing is shared by reference.
      const mint = () =>
        failed({ cause: "c", reason: "r" }, [
          { source: "local" as const, line: "dial 1" },
        ]);
      addSession(
        A,
        makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
        connected(0),
      );
      setState(A, mint());

      const { emits, stop } = drainStatuses(mapDispatch, "a");
      await settle();
      expect(emits.length).toBe(1);

      // Two more frames carrying a structurally IDENTICAL failure record, each built
      // from scratch. Under a reference compare both would publish.
      setState(A, mint());
      setState(A, mint());
      await settle();
      expect(emits.length).toBe(1);

      stop();
      dispose();
    });
  });
});

/** Like `makeRegistry`, but `resolve` can be armed to THROW exactly once for a given
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
        }
      );
    },
  };
  return {
    registry,
    addSession(
      k: HostKey,
      dispatch: SurfaceDispatch,
      state: EntryConnectionState<"copying", TestFailure>,
    ) {
      entries.set(k, { kind: "session", dispatch, state });
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

      addSession(A, makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch, {
        kind: "connecting",
      }); // → warming
      addFault(B, { cause: "drv-missing", reason: "no drv" }); // → failed
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
      addSession(A, entry1.dispatch, connected(0));

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
      addSession(A, entry2.dispatch, connected(0));
      await settle();

      const id2 = idOf();
      expect(id2).toEqual(expect.any(String));
      expect(id2).not.toBe(id1); // never reused — a re-add is a NEW member
      // The REBUILD, proven two ways: the sub now reads the NEW session's value (not
      // stranded at the old 1), and the new session's dispatch got EXACTLY ONE fresh
      // upstream forward — the stale sub was torn down and a genuinely fresh one opened
      // against it.
      expect(awaiting).toBe(2);
      expect(entry2.urgencyGetCount()).toBe(1);
      dispose();
    });
  });

  it("the membershipId is STABLE across a status transition — a mere connected↔warming flip does NOT churn it or rebuild the sub", async () => {
    await createRoot(async (dispose) => {
      const { client, addSession, setState } = setup();
      const entry = makeEntry({ awaiting: 7, awaitingIds: [] });
      addSession(A, entry.dispatch, connected(0));

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
      makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
      connected(0),
    );

    const readIdFromFreshServer = async (): Promise<string | undefined> => {
      const served = serveSurfaceMap(map, reg.registry);
      const client = connectSurfaceMap(map, directDispatch(served));
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
      addSession(A, entryA.dispatch, connected(0));

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
      const client = connectSurfaceMap(map, directDispatch(served));

      reg.addSession(A, makeLiveWhenEntry(1).dispatch, connected(0));

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
      reg.addSession(A, makeLiveWhenEntry(2).dispatch, connected(0));
      await settle();

      expect(n).toBe(2); // the standing sub REBUILT against the new session — not stranded at 1
      served.dispose();
      dispose();
    });
  });
});

// The liveness floor `state()`/foldState applies (D3): a per-key chip must never paint
// green over a dead map transport. The dead-link branch is unreachable through the harness
// (a `directDispatch` is constant-live and a `LiveSignalHandle` is un-forgeable), so the
// floor is extracted PURE (`floorOnLiveness`) and pinned here — foldState routes every
// status through it with the resolved transport `live()`, so this IS the state() decision.
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
// procedures last). On the oRPC nested router that was a live hazard: a reset-not-merge
// build (`inner[member] = {}`) DROPPED the cell's `get` handler when the procedures pass
// ran second, 404-ing `session/get` on every boot and breaking session-restore. On a FLAT
// tag namespace each verb owns its own tag, so the hazard is unspellable — this pins that
// both verbs really are served, which is the property the old merge existed to give.
describe("serveSurfaceMap — a member shared by a cell AND a procedure namespace", () => {
  const collisionSurface = defineSurface({
    cells: {
      session: {
        schema: Schema.Struct({ n: Schema.Number }),
        default: { n: 0 },
        verbs: ["get"], // the CELL verb
      },
    },
    procedures: {
      session: {
        ping: {
          input: Schema.Struct({ echo: Schema.String }),
          output: Schema.String,
        },
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
      // Both tags are advertised by the map's own group — the D1 route-set fact the
      // old accumulate-don't-reset comment was really about.
      expect([...map.group.requests.keys()]).toEqual(
        expect.arrayContaining(["surface/session/get", "surface/session/ping"]),
      );

      const reg = makeRegistry();
      const { handlers } = implementSurface(collisionSurface, {
        cells: { session: { store: inMemoryStore({ n: 7 }) } },
        procedures: {
          session: { ping: ({ input }) => Effect.succeed(input.echo) },
        },
      });
      const served = serveSurfaceMap(map, reg.registry);
      const client = connectSurfaceMap(map, directDispatch(served));
      reg.addSession(A, directDispatch({ handlers }), connected(0));

      // (a) the CELL verb resolves — session/get streams the served store value.
      const cell = client.entry(A).cells.session.use();
      await settle();
      expect(cell.value()).toEqual({ n: 7 });

      // (b) the PROCEDURE verb resolves — session/ping still routes (folds {mapKey}).
      expect(
        await Effect.runPromise(
          client.entry(A).procedures.session.ping({ echo: "pong" }),
        ),
      ).toBe("pong");

      served.dispose();
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
    ping: { inputSchema: Schema.Struct({}), outputSchema: Schema.Number },
  },
});

/** A mock in-process entry surface whose `ping` stream yields ONE value then
 *  completes (typed end) — enough to prove the delegate is callable and tracks
 *  the underlying subscription. */
function makeStreamEntry(value: number) {
  const { handlers } = implementSurface(streamEntrySurface, {
    streams: { ping: { source: () => Stream.make(value) } },
  });
  return { dispatch: directDispatch({ handlers }) };
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
      const client = connectSurfaceMap(map, directDispatch(served));
      reg.addSession(A, makeStreamEntry(42).dispatch, connected(0));

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
      served.dispose();
      dispose();
    });
  });
});

// ── useEntry key identity — encode-keyed, not object-reference-keyed ───────────
// The priority finding: `useEntry`'s swap-root (`createKeyedRoot`, keyed by `mapArray`'s
// `===`) used to re-key whenever the accessor's key VALUE was replaced by a new object,
// even one that encodes to the SAME wire string — e.g. clicking the already-active host
// chip, whose `props.host` is a FRESH decoded object each membership read. A plain
// string key (the harness's `identityCodec` above) can't reproduce this: JS strings
// compare by VALUE, so `"a" === "a"` regardless of how each was minted. kolu's real
// `HostKey` is an OBJECT (a discriminated sum) — this describe block uses an
// object-shaped key + a non-identity codec to reproduce the same reference trap.
describe("useEntry key identity — encode-keyed, not object-reference-keyed", () => {
  const ObjKeySchema = Schema.Struct({
    kind: Schema.Literal("host"),
    name: Schema.String,
  });
  type ObjKey = typeof ObjKeySchema.Type;
  const objCodec: KeyCodec<ObjKey> = {
    encode: (k) => k.name,
    decode: (s) => ({ kind: "host", name: s }),
  };
  // A FRESH decode always mints a brand-new object — the same shape a schema decode
  // does for kolu's real `HostKey` even on an already-valid input.
  const decodeObjKey = Schema.decodeUnknownSync(ObjKeySchema);
  const freshA = (): ObjKey => decodeObjKey({ kind: "host", name: "a" });

  function objRegistry() {
    const entries = new Map<
      string,
      {
        kind: "session";
        dispatch: SurfaceDispatch;
        state: EntryConnectionState<"copying", TestFailure>;
      }
    >();
    const listeners = new Set<() => void>();
    const fire = () => {
      for (const l of [...listeners]) l();
    };
    const registry: MapRegistry<ObjKey, "copying", TestFailure> = {
      members: () =>
        [...entries.keys()].map((name) => ({
          kind: "host" as const,
          name,
        })),
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
        },
    };
    return {
      registry,
      addSession(
        k: ObjKey,
        dispatch: SurfaceDispatch,
        state: EntryConnectionState<"copying", TestFailure>,
      ) {
        entries.set(k.name, { kind: "session", dispatch, state });
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
      addSession(freshA(), makeStreamEntry(9).dispatch, connected(0));
      const served = serveSurfaceMap(map, registry);
      const client = connectSurfaceMap(map, directDispatch(served));

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

      served.dispose();
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
      addSession(freshA(), makeStreamEntry(0).dispatch, connected(0));
      const served = serveSurfaceMap(map, registry);
      const client = connectSurfaceMap(map, directDispatch(served));

      const view = client.entries.use();
      await settle();
      const keys1 = view.keys();
      const keys2 = view.keys();
      expect(keys1).toHaveLength(1);
      // SAME reference, not just deep-equal — a reference-keyed `<For>` (kolu's
      // HostSelectorStrip) reconciles only a genuinely changed row, not every row on
      // every read.
      expect(keys1[0]).toBe(keys2[0]);
      served.dispose();
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
      makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
      connected(0),
    ); // registers the CANONICAL member "a"
    const served = serveSurfaceMap(map, reg.registry);
    const dispatch = directDispatch(served);

    // A DECLARED rejection (D4), not a defect: the folded `entries/get` member declares
    // `MapKeyNonCanonical`, so the failure crosses a wire with its two keys intact.
    const failure = await Effect.runPromise(
      Effect.flip(
        Stream.runCollect(
          dispatch.stream(ENTRIES_GET_TAG, { key: "A" }) as Stream.Stream<
            unknown,
            unknown
          >,
        ),
      ),
    );
    expect(failure).toMatchObject({
      _tag: "MapKeyNonCanonical",
      wireKey: "A",
      canonicalKey: "a",
    });
    expect(String(failure)).toMatch(/canonical/i);
    served.dispose();
  });
});
