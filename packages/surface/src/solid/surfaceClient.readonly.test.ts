/**
 * `surfaceClient` honors a cell's `verbs` — the CLIENT-side dual of the raw
 * contract honoring `verbs` (`define.test.ts`).
 *
 * A get-only cell (`verbs: ["get"]`, e.g. `@kolu/surface-remote`'s
 * connection-health cell) must bind to a READ-ONLY view: no `.set` / `.patch`
 * and no `authority: "local"` path. The raw contract router carries no `set`
 * for such a cell, so a typed `app.cells.<getOnly>.use(...).set(...)` would be
 * an API-facing falsehood that throws "no mutate handler" at runtime — the very
 * forge-the-health-signal hole the get-only cell exists to close. This file
 * pins BOTH halves (the bound type and the runtime mutate binding) so a refactor
 * can't regrow the phantom mutation path on the Solid client.
 */

import { Effect, Schema, Stream } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import type { SurfaceDispatch } from "../link";
import { surfaceClient } from "./surfaceClient";

const surface = defineSurface({
  cells: {
    // Read-only: the parent owns it server-side; the wire carries only `get`.
    conn: {
      schema: Schema.Struct({ state: Schema.String }),
      default: { state: "connecting" },
      verbs: ["get"],
    },
    // A get-only cell whose stub stream REJECTS — drives the `onError`
    // pass-through test. `ReadOnlyBoundCellOptions` exposes `onError`, and the
    // read-only branch must thread it to `useCellServer` so a get-only stream
    // failure reaches callback-based error handling, not just `error()`.
    connFail: {
      schema: Schema.Struct({ state: Schema.String }),
      default: { state: "connecting" },
      verbs: ["get"],
    },
    // Mutable (default verbs `["get", "set"]`) — the contrast case.
    prefs: {
      schema: Schema.Struct({ theme: Schema.String }),
      default: { theme: "dark" },
    },
    // Read-only on the client: `test__set` is the e2e reset procedure, not a
    // consumer mutation (e.g. `activityFeed` / `session`). The server is the
    // sole writer, so the bound cell must NOT advertise `.set` the runtime
    // can't service — `mutate` stays undefined despite the non-`get` verb.
    feed: {
      schema: Schema.Struct({ items: Schema.Array(Schema.String) }),
      default: { items: [] },
      verbs: ["get", "test__set"],
    },
    // A `patchSchema` cell that explicitly exposes `set` (not `patch`). The
    // binding must follow the exposed verb, so it captures `ns.set`, not the
    // `ns.patch` a naive `patchSchema ? "patch" : "set"` would reach for. The
    // patch shape (`{ delta }`) is DELIBERATELY different from the full value
    // (`{ n, label }`): the wire serves only the full-value `set`, so the bound
    // cell must collapse its client patch shape to the full value `T` — a
    // `.patch({ delta })` would post a partial the `set` endpoint rejects.
    explicitSet: {
      schema: Schema.Struct({ n: Schema.Number, label: Schema.String }),
      default: { n: 0, label: "" },
      patchSchema: Schema.Struct({ delta: Schema.Number }),
      verbs: ["get", "set"],
      // A spec-level `patch` merger over the partial `P` (`{ delta }`). The
      // server uses it for the `patch` wire verb — but this cell exposes only
      // `set`, so the CLIENT must NOT auto-inject it as the local-authority
      // `applyPatch`: the local path now carries full `T` values, and this
      // merger expects a partial `P`. `surfaceClient` records a sentinel so the
      // regression test can assert it was never injected. Annotate the params
      // explicitly so the unary callback doesn't perturb `defineSurface`'s `P`
      // inference (an unannotated `patch` arg would widen `P` and unmask the
      // collapse the type assertions below pin).
      patch: (
        current: { n: number; label: string },
        patch: { delta: number },
      ): { n: number; label: string } => {
        specPatchCalls.push(patch);
        return { ...current, n: current.n + patch.delta };
      },
    },
  },
});

/** Records every call to `explicitSet`'s spec-level `patch` merger. The
 *  local-authority regression test asserts this stays EMPTY — the set-only
 *  bound shape carries full `T`, so the client must full-replace, never route
 *  a `T` through this `P`-merger. */
const specPatchCalls: { delta: number }[] = [];

/** A stub DISPATCH exposing only the tags the contract actually carries — the
 *  get-only cells have `surface/<cell>/get` and nothing else, so a `surfaceClient`
 *  that reached for an absent `set` would hit the unbound-tag failure below.
 *
 *  `surfaceClient` no longer takes a hand-built nested link: it takes a
 *  {@link SurfaceDispatch} and builds the `surface.<member>.<verb>` face itself
 *  (`buildSurfaceFace`), so the stub moved one layer down to the flat wire tags. */
function stubDispatch() {
  // A live-but-silent stream (never yields, never ends): the bound `.use()` here is
  // asserted on its BINDING, not on a delivered frame.
  const silent = Stream.never;
  const setSpy = { called: false };
  const streams: Record<string, () => Stream.Stream<unknown, unknown>> = {
    "surface/conn/get": () => silent,
    // A get-only cell whose stream FAILS the moment it is run —
    // `createSubscription` records it in `error()` and (only if `onError` was
    // threaded through) invokes the callback.
    "surface/connFail/get": () => Stream.fail(new Error("stream boom")),
    "surface/prefs/get": () => silent,
    "surface/feed/get": () => silent,
    "surface/explicitSet/get": () => silent,
  };
  const unaries: Record<string, () => Promise<unknown>> = {
    "surface/prefs/set": () => {
      setSpy.called = true;
      return Promise.resolve();
    },
    // Mirrors the served tag set for a `["get", "test__set"]` cell — a
    // `test__set` verb but NO `set`/`patch`. `surfaceClient` must not reach for
    // an absent `surface/feed/set`.
    "surface/feed/test__set": () => Promise.resolve(),
    // A `patchSchema` cell exposing `set` (not `patch`) — only the `set` tag is
    // on the wire. The binding must capture `set`, not the absent `patch`.
    "surface/explicitSet/set": () => Promise.resolve(),
  };
  const dispatch: SurfaceDispatch = {
    unary: (tag) => {
      const fn = unaries[tag];
      if (!fn) return Effect.fail(new Error(`no member served at "${tag}"`));
      return Effect.tryPromise({ try: () => fn(), catch: (e) => e });
    },
    stream: (tag) => {
      const fn = streams[tag];
      if (!fn) return Stream.fail(new Error(`no member served at "${tag}"`));
      return Stream.suspend(fn);
    },
  };
  return { setSpy, dispatch };
}

describe("surfaceClient cell verbs", () => {
  it("does NOT bind a mutate for a get-only cell (no phantom `ns.set`)", () => {
    const { dispatch } = stubDispatch();
    const app = surfaceClient(surface, dispatch);
    // The bound read-only cell exposes `.use` but no imperative mutate; the
    // runtime closure captured `mutate === undefined`, so even reaching the
    // server-authority `set` would throw rather than call an absent `ns.set`.
    const conn = app.cells.conn;
    expect(typeof conn.use).toBe("function");
    // @ts-expect-error — a read-only bound cell's `.use()` result has no `set`.
    type _NoSet = ReturnType<typeof conn.use>["set"];
    // The local-authority path is rejected at BOTH the type and the runtime: the
    // line below is a TS error (the `@ts-expect-error` pins that), and forcing it
    // through throws rather than seeding a local store (the runtime dual lives in
    // its own test below).
    expect(() =>
      // @ts-expect-error — a get-only cell rejects the local-authority path.
      conn.use({ authority: "local", initial: { state: "x" } }),
    ).toThrow(/get-only/);
  });

  it("a get-only cell's `.use()` is read-only at RUNTIME — no `set`/`patch`, and forced `authority: 'local'` throws BEFORE any local store is seeded", () => {
    const { dispatch } = stubDispatch();
    const app = surfaceClient(surface, dispatch);
    createRoot((dispose) => {
      // The runtime dual of the type-level guard above: a JS / `any` caller can't
      // be stopped by TS, so the binding must REFUSE the local-authority path
      // outright rather than seed a store and half-apply a write before the
      // missing-mutate throw.
      expect(() =>
        // biome-ignore lint/suspicious/noExplicitAny: a JS caller forces the path the type forbids.
        (app.cells.conn.use as any)({
          authority: "local",
          initial: { state: "x" },
        }),
      ).toThrow(/get-only/);

      // The honest read-only path: server-authority `.use()` yields ONLY
      // value/pending/error/sub — `set`/`patch` are absent at runtime, so a
      // forge-the-health write has nothing to call.
      const ro = app.cells.conn.use();
      expect(typeof ro.value).toBe("function");
      expect(typeof ro.pending).toBe("function");
      expect(typeof ro.error).toBe("function");
      // biome-ignore lint/suspicious/noExplicitAny: probing for absence of a runtime field the type already hides.
      expect((ro as any).set).toBeUndefined();
      // biome-ignore lint/suspicious/noExplicitAny: probing for absence of a runtime field the type already hides.
      expect((ro as any).patch).toBeUndefined();
      dispose();
    });
  });

  it("threads `onError` through a get-only cell's read-only `.use()` so a stream failure reaches the callback", async () => {
    const { dispatch } = stubDispatch();
    const app = surfaceClient(surface, dispatch);
    await createRoot(async (dispose) => {
      const errors: Error[] = [];
      // `ReadOnlyBoundCellOptions` carries only `onError`. The read-only branch
      // must forward it to the server-authority subscription; without the
      // pass-through this callback would NEVER fire on a get-only stream failure
      // — the cell would error()-out silently for callback-based consumers.
      app.cells.connFail.use({ onError: (err) => errors.push(err) });
      // `createSubscription` sets `error()` async (the source rejects on await),
      // then a `createEffect` on `error()` invokes `onError`. Flush microtasks.
      await Promise.resolve();
      await Promise.resolve();
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/stream boom/);
      dispose();
    });
  });

  it("binds `set` for a default mutable cell", () => {
    const { dispatch } = stubDispatch();
    const app = surfaceClient(surface, dispatch);
    const prefs = app.cells.prefs;
    // The mutable cell keeps its imperative mutate surface.
    type Result = ReturnType<typeof prefs.use>;
    const hasSet: "set" extends keyof Result ? true : false = true;
    expect(hasSet).toBe(true);
    expect(typeof prefs.use).toBe("function");
  });

  it("treats a `['get', 'test__set']` cell as read-only (test__set is not a consumer mutation)", () => {
    const { dispatch } = stubDispatch();
    const app = surfaceClient(surface, dispatch);
    const feed = app.cells.feed;
    expect(typeof feed.use).toBe("function");
    // @ts-expect-error — `test__set` doesn't make the cell mutable on the client.
    type _NoSet = ReturnType<typeof feed.use>["set"];
    // A `['get', 'test__set']` cell is read-only on the client (no consumer
    // mutate verb), so the local-authority path is rejected at the type AND the
    // runtime — forcing it through throws rather than seeding a local store.
    expect(() =>
      // @ts-expect-error — the local-authority path is rejected: no client mutate verb.
      feed.use({ authority: "local", initial: { items: [] } }),
    ).toThrow(/get-only/);
  });

  it("binds the exposed `set` for a patchSchema cell that lists `set` (not `patch`)", () => {
    const { dispatch } = stubDispatch();
    const app = surfaceClient(surface, dispatch);
    const explicitSet = app.cells.explicitSet;
    // Mutable: `set` is exposed, so the imperative mutate surface is present.
    type Result = ReturnType<typeof explicitSet.use>;
    const hasSet: "set" extends keyof Result ? true : false = true;
    expect(hasSet).toBe(true);
    // The runtime bound `ns.set` (not the absent `ns.patch`); reaching the
    // local-authority path would otherwise throw "no mutate handler".
    expect(typeof explicitSet.use).toBe("function");

    // The client patch shape COLLAPSES to the full value `T` (`{ n, label }`),
    // because the only wire mutation is the full-value `set`. A `.patch` of the
    // declared partial `patchSchema` (`{ delta }`) must NOT typecheck — that
    // would post a partial payload the `set` endpoint would reject. These two
    // assertions pin the soundness the differing `T`/`P` exists to catch.
    const result = explicitSet.use();
    // `.patch` accepts the full value — sound against `set`.
    void (() => result.patch({ n: 1, label: "x" }));
    // @ts-expect-error — `.patch` must reject the partial `{ delta }`: a set-only
    // cell has no `P`-shaped wire procedure, so its client patch shape is `T`.
    void (() => result.patch({ delta: 1 }));
  });

  it("does NOT auto-inject the spec-level `patch` merger as the local-authority applyPatch for a set-only cell", async () => {
    specPatchCalls.length = 0;
    const { dispatch } = stubDispatch();
    await createRoot(async (dispose) => {
      const app = surfaceClient(surface, dispatch);
      // Local authority over the set-only cell. The bound shape is
      // `BoundCell<T, T>`, so `.patch` carries the FULL value `{ n, label }`.
      const cell = app.cells.explicitSet.use({
        authority: "local",
        initial: { n: 5, label: "seed" },
      });
      // A full-value local write. `surfaceClient` must NOT have injected the
      // spec-level `patch` (a `P`-merger expecting `{ delta }`) as `applyPatch`;
      // with no `applyPatch`, `useCell` full-replaces the store.
      await cell.patch({ n: 9, label: "next" });
      // Full replacement landed — NOT the merger's `current.n + delta` (which,
      // fed a full `T`, would read `patch.delta === undefined` and corrupt `n`).
      expect(cell.value()).toEqual({ n: 9, label: "next" });
      // The `P`-merger was never wired in, so it was never called.
      expect(specPatchCalls).toHaveLength(0);
      dispose();
    });
  });
});
