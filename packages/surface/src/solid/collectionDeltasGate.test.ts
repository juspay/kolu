/**
 * The whole-collection `.use()` deltas/per-key gate must decide from the SPEC's
 * verbs, NOT by asking the TRANSPORT whether a `deltas` stream exists. A wire
 * dispatch answers whatever tag it is handed — it has no idea which members the
 * server actually registered — so a transport-level probe is effectively `true`
 * for EVERY collection: it would route a non-opted whole-collection `.use()` into
 * a `deltas` call the server never registered, the stream would reject, and the
 * collection would silently read empty. (Under oRPC the same hazard wore a
 * different costume: the wire client was a lazy Proxy whose every property access
 * returned a truthy callable, so `(ns as any).deltas` read truthy for every
 * collection.) This pins the gate to the spec: a collection WITHOUT the `deltas`
 * verb takes the per-key keys-stream path even when the transport would happily
 * answer its `deltas` tag; one WITH it takes the single batched stream.
 */

import { Effect, Schema, Stream } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { type CollectionDeltasMsg, defineSurface } from "../define";
import type { SurfaceDispatch } from "../link";
import { controllableStream } from "./controllableStream.testlib";
import { surfaceClient } from "./surfaceClient";
import { useCollectionDeltas } from "./useCollection";

const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

const surface = defineSurface({
  collections: {
    // Default verbs — NOT opted into `deltas`.
    plain: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
    },
    // Opted into the batched stream.
    batched: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
      verbs: ["keys", "get", "upsert", "delete", "deltas"],
    },
  },
});

/** One frame, delivered ASYNCHRONOUSLY then a typed end. Async on purpose: a
 *  synchronous `Stream.make` runs to completion inside `Effect.runFork`, so its
 *  typed end would land before `.use()` even returned — a real wire stream always
 *  crosses an await first. */
function yieldOnce<T>(value: T): Stream.Stream<T, unknown> {
  return Stream.fromAsyncIterable(
    (async function* () {
      yield value;
    })(),
    (e) => e,
  );
}

/** A dispatch that answers ANY tag — the transport-level shape of the hazard.
 *  A `keys` tag yields one empty key set, a `deltas` tag one empty snapshot, and
 *  anything else stays silently open; NOTHING here knows which verbs a given
 *  collection declared, which is exactly the point: the transport cannot be the
 *  gate's source of truth, so if the gate consulted it every collection would
 *  route through `deltas`. */
function answersAnyTagDispatch(): SurfaceDispatch {
  return {
    unary: () => Effect.succeed(undefined),
    stream: (tag) =>
      Stream.suspend<unknown, unknown, never>(() => {
        if (tag.endsWith("/keys")) return yieldOnce<string[]>([]);
        if (tag.endsWith("/deltas"))
          return yieldOnce({ kind: "snapshot", entries: [] });
        // Any other tag: an open, silent stream — the transport is equally happy
        // to serve it, which is the mis-read the old gate made.
        return Stream.never;
      }),
  };
}

describe("collection deltas — byKey contract over the single batched stream", () => {
  it("byKey reads value/absent/removed like the per-key path, with collection-wide error()/pending()", async () => {
    type V = { v: number };
    await createRoot(async (dispose) => {
      const { source, push } =
        controllableStream<CollectionDeltasMsg<string, V>>();
      const view = useCollectionDeltas<"batched", string, V>(
        // biome-ignore lint/suspicious/noExplicitAny: descriptor is a runtime type-discriminator only
        (surface.descriptors.collections as any).batched,
        { source },
      );

      // Snapshot establishes one present key; an absent key reads `undefined`
      // (NOT a live accessor) — the contract the per-key path also holds.
      push({ kind: "snapshot", entries: [["a", { v: 1 }]] });
      await settle();
      expect(view.byKey("a")?.()).toEqual({ v: 1 });
      expect(view.byKey("absent")).toBeUndefined();

      // A delta upsert makes a previously-absent key present and readable.
      push({ kind: "delta", upserts: [["b", { v: 2 }]], removes: [] });
      await settle();
      expect(view.byKey("b")?.()).toEqual({ v: 2 });

      // error()/pending() are the SINGLE batched stream's — collection-wide and
      // shared across keys, NOT per-key (the documented divergence the byKey
      // receptacle now spells out). Two present keys share the same accessors.
      const a = view.byKey("a");
      const b = view.byKey("b");
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a?.error).toBe(b?.error);
      expect(a?.pending).toBe(b?.pending);

      // A delta remove returns the key to `undefined`, same as the per-key path.
      push({ kind: "delta", upserts: [], removes: ["a"] });
      await settle();
      expect(view.byKey("a")).toBeUndefined();
      expect(view.byKey("b")?.()).toEqual({ v: 2 });

      dispose();
    });
  });
});

describe("collection deltas — opt-in gate reads the spec, not the transport", () => {
  it("a non-opted collection takes the per-key path even when the transport would answer its deltas tag", async () => {
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, answersAnyTagDispatch());
      app.collections.plain.use({});
      app.collections.batched.use({});
      await settle();

      const names = app.health().subs.map((s) => s.name);
      // plain (no `deltas` verb) → the per-key keys-stream, never the batched one.
      expect(names).toContain("plain.keys");
      expect(names).not.toContain("plain.deltas");
      // batched (opted in) → the single folded deltas sub, never the keys-stream.
      expect(names).toContain("batched.deltas");
      expect(names).not.toContain("batched.keys");
      dispose();
    });
  });
});

/** A `plain`-collection DISPATCH whose `keys` stream and each per-key `get` stream
 *  are independently controllable — lets a test drive a real collection-level error
 *  (the keys stream faulting) or a real per-key value-stream error, distinctly and on
 *  demand, over the exact two error channels the whole-collection `.use()` dedup
 *  branch wires its shared `onError` dispatcher into. `surface/batched/deltas` is a
 *  silent, immediately-ending stub — only exercised here for the "distinct collection
 *  takes its own first onError, no interaction with `plain`'s registry" case. */
function faultablePlainDispatch() {
  const keys = controllableStream<string[]>();
  const values = new Map<
    string,
    ReturnType<typeof controllableStream<{ v: number }>>
  >();
  function valueStream(key: string) {
    let s = values.get(key);
    if (!s) {
      s = controllableStream<{ v: number }>();
      values.set(key, s);
    }
    return s;
  }
  const dispatch: SurfaceDispatch = {
    unary: () => Effect.succeed(undefined),
    stream: (tag, payload) =>
      Stream.suspend<unknown, unknown, never>(() => {
        if (tag === "surface/plain/keys") return keys.source;
        if (tag === "surface/plain/get") {
          return valueStream((payload as { key: string }).key).source;
        }
        if (tag === "surface/batched/deltas") {
          return Stream.fromAsyncIterable<never, unknown>(
            (async function* () {})(),
            (e) => e,
          );
        }
        return Stream.fail(new Error(`no member served at "${tag}"`));
      }),
  };
  return {
    dispatch,
    pushKeys: (ks: string[]) => keys.push(ks),
    failKeys: (e: unknown) => keys.fail(e),
    pushValue: (key: string, v: { v: number }) => valueStream(key).push(v),
    failValue: (key: string, e: unknown) => valueStream(key).fail(e),
  };
}

describe("collection onError — per-consumer registry: every handler fires, none dropped", () => {
  it("bare + identical + a DIFFERENT second onError all SHARE one slot (no throw); both distinct handlers fire", async () => {
    await createRoot(async (dispose) => {
      const { dispatch, failKeys } = faultablePlainDispatch();
      const app = surfaceClient(surface, dispatch);
      const fires1: Error[] = [];
      const fires2: Error[] = [];
      const onError1 = (e: Error) => fires1.push(e);
      const onError2 = (e: Error) => fires2.push(e);

      // First consumer registers onError1 into the shared slot.
      expect(() =>
        app.collections.plain.use({ onError: onError1 }),
      ).not.toThrow();
      // A second consumer with NO onError shares fine (registers nothing).
      expect(() => app.collections.plain.use({})).not.toThrow();
      // A second consumer with the IDENTICAL handler shares fine — refcounted, so it
      // still fires exactly once per error (not twice) below.
      expect(() =>
        app.collections.plain.use({ onError: onError1 }),
      ).not.toThrow();
      // A second consumer with a DIFFERENT onError now SHARES too (no throw) — the old
      // throw's own message named the fix (per-consumer wiring); it's now built, so a
      // divergent handler is simply ADDED to the slot's registry alongside the first.
      expect(() =>
        app.collections.plain.use({ onError: onError2 }),
      ).not.toThrow();

      await settle();
      // The keys stream is built EAGERLY (inside the shared slot's factory, at the
      // first `.use()`), so faulting it needs no `byKey` read to force anything alive.
      failKeys(new Error("boom"));
      await settle();

      // BOTH the first and the divergent second handler fired — neither was dropped
      // (the silent-drop defect the old throw guarded against, now actually fixed
      // instead of refused). The identical-ref registration above did NOT double-fire.
      expect(fires1.length).toBe(1);
      expect(fires2.length).toBe(1);

      // A DISTINCT collection with no prior registration takes its own first onError,
      // independent of `plain`'s registry.
      expect(() =>
        app.collections.batched.use({ onError: onError2 }),
      ).not.toThrow();
      dispose();
    });
  });

  it("REVERSE order: a bare .use() FIRST then a handler .use() now SHARES (no throw) — order no longer matters", async () => {
    await createRoot(async (dispose) => {
      const { dispatch, failKeys } = faultablePlainDispatch();
      const app = surfaceClient(surface, dispatch);
      const fires: Error[] = [];
      const handler = (e: Error) => fires.push(e);

      // The trap the multi-host membership strip hit at runtime: a BARE consumer
      // (`HostSelectorStrip`'s `<For>`) baked the shared slot with NO onError FIRST, then
      // the HANDLER consumer (`wire.ts`'s reconcile sub) added one SECOND. That used to
      // THROW (order-asymmetric — handler-first-then-bare shared fine, the reverse
      // didn't); now both orders just register, so co-consumers no longer need to
      // coordinate on a shared handler reference to avoid a crash.
      app.collections.plain.use({});
      expect(() =>
        app.collections.plain.use({ onError: handler }),
      ).not.toThrow();

      await settle();
      failKeys(new Error("boom"));
      await settle();
      expect(fires.length).toBe(1);
      dispose();
    });
  });
});

describe("collection onError — three consumers, three handlers, per-owner unregister", () => {
  it("all three fire on a collection error; disposing one consumer's owner stops JUST its handler", async () => {
    await createRoot(async (dispose) => {
      const { dispatch, pushKeys, failValue } = faultablePlainDispatch();
      const app = surfaceClient(surface, dispatch);

      const fires1: Error[] = [];
      const fires2: Error[] = [];
      const fires3: Error[] = [];
      const onError1 = (e: Error) => fires1.push(e);
      const onError2 = (e: Error) => fires2.push(e);
      const onError3 = (e: Error) => fires3.push(e);

      // Consumers 1 and 3 live for the whole test (attached to the outer root, disposed
      // only at the very end). Consumer 2 gets its OWN nested root so it can be disposed
      // independently, mid-test, without touching the other two.
      const view1 = app.collections.plain.use({ onError: onError1 });
      let disposeConsumer2 = (): void => {};
      createRoot((d) => {
        disposeConsumer2 = d;
        app.collections.plain.use({ onError: onError2 });
      });
      app.collections.plain.use({ onError: onError3 });

      await settle();
      pushKeys(["k1", "k2"]);
      await settle();
      // Per-key value subs are created LAZILY on the first `byKey` read — force BOTH
      // k1 and k2 into existence so each can independently fault below.
      view1.byKey("k1");
      view1.byKey("k2");
      await settle();

      // A real collection error (k1's per-key value stream faults) reaches ALL three —
      // however many consumers there are, all registered handlers fire.
      failValue("k1", new Error("boom-1"));
      await settle();
      expect(fires1.length).toBe(1);
      expect(fires2.length).toBe(1);
      expect(fires3.length).toBe(1);

      // Dispose consumer 2's own reactive owner — its handler unregisters from the
      // shared slot's registry, independent of the slot's own (still-live) lifetime.
      disposeConsumer2();

      // A second, INDEPENDENT fault (k2's value stream — a distinct subscription; k1's
      // already-errored one never restarts) now reaches only the two SURVIVING
      // consumers — consumer 2's handler does not fire again.
      failValue("k2", new Error("boom-2"));
      await settle();
      expect(fires1.length).toBe(2);
      expect(fires2.length).toBe(1); // unchanged — unregistered on its owner's disposal
      expect(fires3.length).toBe(2);

      dispose();
    });
  });
});

/** A `plain` collection's KEYS stream whose FIRST generation yields once then
 *  completes TYPED (a re-served collection / member removal — the shape that
 *  evicts the dedup slot from `slots` while a still-mounted consumer keeps its
 *  singleton root alive), and whose SECOND (and any later) generation is a
 *  controllable stream the test drives by hand. Reproduces the exact shape the
 *  generation-torn defect needs: a dead generation's disposal running alongside
 *  a live generation's registry and dispatcher. */
function generationalKeysDispatch() {
  let call = 0;
  let liveGen: ReturnType<typeof controllableStream<string[]>> | undefined;
  const dispatch: SurfaceDispatch = {
    unary: () => Effect.succeed(undefined),
    stream: (tag) =>
      Stream.suspend<unknown, unknown, never>(() => {
        if (tag === "surface/plain/keys") {
          call++;
          // GEN 1: one empty frame, then a TYPED end.
          if (call === 1) return yieldOnce<string[]>([]);
          // GEN 2+: stays open — the test faults it on demand.
          liveGen = controllableStream<string[]>();
          return liveGen.source;
        }
        // Never run: keys stays `[]` throughout (this test only exercises the
        // keys-stream's OWN error channel, not any per-key value stream).
        if (tag === "surface/plain/get") return Stream.never;
        return Stream.fail(new Error(`no member served at "${tag}"`));
      }),
  };
  return { dispatch, failLiveGen: (e: unknown) => liveGen?.fail(e) };
}

describe("collection onError — generation-torn registry (CONFIRMED fix)", () => {
  it("a late-joining consumer under a NEW generation still fires, even after the OLD (dead) generation's own disposal", async () => {
    await createRoot(async (dispose) => {
      const { dispatch, failLiveGen } = generationalKeysDispatch();
      const app = surfaceClient(surface, dispatch);

      const fires1: Error[] = [];
      const fires2: Error[] = [];
      const fires3: Error[] = [];
      const onError1 = (e: Error) => fires1.push(e);
      const onError2 = (e: Error) => fires2.push(e);
      const onError3 = (e: Error) => fires3.push(e);

      // C1: its OWN root — registers h1, opens GEN 1 (auto-completing keys stream).
      let disposeC1 = (): void => {};
      createRoot((d) => {
        disposeC1 = d;
        app.collections.plain.use({ onError: onError1 });
      });
      // GEN 1's keys stream yields once then completes → TYPED end → the dedup
      // cache evicts GEN 1 from `slots` — but its singleton root stays alive
      // (C1 is still mounted; eviction ≠ disposal).
      await settle();

      // C2: its OWN root — registers h2. `slots.get` is now empty for this
      // collection key (GEN 1 was evicted), so a NEW slot (GEN 2, the
      // controllable stream) is built. This is now the LIVE generation.
      let disposeC2 = (): void => {};
      createRoot((d) => {
        disposeC2 = d;
        app.collections.plain.use({ onError: onError2 });
      });
      await settle();

      // C1 disposes. Its OWN per-consumer unregister removes h1 from the
      // registry. The now-fixed code's slot-level `onCleanup` (GEN 1's, firing
      // as C1's root tears down) must NOT touch the registry at all — the
      // registry's lifetime is the CONSUMERS', not a slot generation's. The
      // bug this pins: the OLD code's GEN-1 `onCleanup` unconditionally ran
      // `collOnError.delete(collKey)`, silently deleting the registry GEN 2's
      // dispatcher and every later-joining consumer still depend on.
      disposeC1();
      await settle();

      // C3 joins the STILL-LIVE GEN 2 slot (no new slot is built — `slots.get`
      // already holds it), registering h3 into whatever registry is live NOW.
      // Its OWN root — same as C1/C2 — is REQUIRED here, not cosmetic: this call
      // runs after three `await`s inside the outer async `createRoot`, and Solid
      // does not preserve an ambient owner across an `await` (`createRoot`'s
      // `finally` restores `Owner` to the pre-call value the moment the async
      // callback first suspends). A bare inline call at this point would itself be
      // an OWNERLESS `.use({onError})` — exactly the leak class this file's
      // dedicated "ownerless registration" test below pins.
      let disposeC3 = (): void => {};
      createRoot((d) => {
        disposeC3 = d;
        app.collections.plain.use({ onError: onError3 });
      });
      await settle();

      failLiveGen(new Error("boom"));
      await settle();

      // h1 must NOT fire — its consumer already unmounted. h2 AND h3 — the two
      // LIVE consumers of the one live (GEN 2) slot — MUST both fire. Losing h3
      // is exactly the generation-torn silent-drop defect: under the old code,
      // GEN 2's dispatcher captured the registry BY REFERENCE at build time,
      // and GEN 1's stale cleanup had already deleted the KEYED entry a late
      // joiner (C3) would otherwise have found and shared.
      expect(fires1.length).toBe(0);
      expect(fires2.length).toBe(1);
      expect(fires3.length).toBe(1);

      disposeC2();
      disposeC3();
      dispose();
    });
  });
});

describe("collection onError — ownerless registration must not leak (the unguarded sibling of the cache's ownerless read() fix)", () => {
  it("PIN — an ownerless .use({onError}) does not durably register the handler; a later generation's error never reaches it", async () => {
    const { dispatch, failKeys } = faultablePlainDispatch();
    const app = surfaceClient(surface, dispatch);
    const fires: Error[] = [];
    const leaky = (e: Error) => fires.push(e);

    // Call `.use({onError})` completely OWNERLESS — no `createRoot` wrapping, mirroring
    // kolu's DOM-event-handler read (the exact caller class the keyedSubscriptionCache
    // `read()` docblock names). `getOwner()` is null here (top-level test body, no
    // reactive scope), so — pre-fix — `handlers.set(leaky, 1)` runs but the paired
    // `onCleanup` at surfaceClient.ts:800 warns-and-no-ops: the increment is NEVER
    // paired with a decrement, a PERMANENT registry leak.
    app.collections.plain.use({ onError: leaky });
    await settle();

    // A REAL, owned consumer joins afterward with NO handler of its own. Because the
    // ownerless call's underlying dedup slot already transiently acquired-and-released
    // (the cache's already-fixed `read()`), this opens a FRESH generation.
    let disposeReal = (): void => {};
    createRoot((d) => {
      disposeReal = d;
      app.collections.plain.use({});
    });
    await settle();

    failKeys(new Error("boom"));
    await settle();

    // Without the fix: `leaky` is still sitting in `collOnError` (never unregistered)
    // and `dispatchError` reads the registry LIVE by key — so it fires on this fresh
    // generation's error even though its "consumer" never had a lifetime to observe
    // it. With the fix, an ownerless `.use({onError})` must not durably register.
    expect(fires.length).toBe(0);

    disposeReal();
  });
});
