/**
 * SR11 — the client-policy INTERPRETER seam, exercised at RUNTIME (codex round-1 F2).
 *
 * `packages/client/src/surfacePolicyUseSiteGuard.test.ts` is a source-TEXT guard: it
 * pins that no use-site re-hand-wires a policy, but it never DRIVES the runtime that
 * routes a declared `client.onError` policy through `buildSurfaceClient`'s
 * `onClientError` interpreter. This file closes that gap — every test here builds a
 * real `buildSurfaceClient` over a stub dispatch and asserts the interpreter is invoked
 * (or the construction throws) for genuine subscription / flush failures.
 *
 * The policy VALUE is opaque, app-typed data the framework never inspects — so these
 * tests declare a tiny `{ kind: "toast"; label }` union via `defineSurfaceWithPolicy`
 * and assert the interpreter receives that EXACT declared value plus the error.
 */

import { Effect, Schema, Stream } from "effect";
import { createRoot, getOwner } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { defineSurfaceWithPolicy } from "../define";
import type { SurfaceDispatch } from "../link";
import { buildSurfaceClient, type OnClientError } from "./surfaceClient";

// The app-owned policy union — opaque to the framework; only the interpreter reads it.
type Policy = { kind: "toast"; label: string };

const WATCH_POLICY: Policy = { kind: "toast", label: "watch" };
const PREFS_POLICY: Policy = { kind: "toast", label: "prefs" };
const MEMBERS_POLICY: Policy = { kind: "toast", label: "members" };

/** The policy-bearing surface every dispatch test drives:
 *   - `watch`  — a server-authority read-only cell with a declared policy.
 *   - `prefs`  — a local-authority (coalesced) cell with a declared policy — its
 *                flush failure routes through the SAME interpreter as its sub drop.
 *   - `members` — a collection with a declared policy. */
const surface = defineSurfaceWithPolicy<Policy>()({
  cells: {
    watch: {
      schema: Schema.Struct({ n: Schema.Number }),
      default: { n: 0 },
      verbs: ["get"],
      client: { onError: WATCH_POLICY },
    },
    prefs: {
      schema: Schema.Struct({ size: Schema.Number }),
      default: { size: 1 },
      // zod's `.partial()` → `Schema.optionalKey` per the #17 mapping LAW
      // (`Schema.optional` would round-trip an explicit `undefined` through
      // `null`, changing the encoded bytes).
      patchSchema: Schema.Struct({
        size: Schema.optionalKey(Schema.Number),
      }),
      patch: (cur: { size: number }, p: { size?: number }) => ({
        ...cur,
        ...p,
      }),
      verbs: ["get", "patch"],
      client: { onError: PREFS_POLICY, authority: "local", coalesceMs: 30 },
    },
  },
  collections: {
    members: {
      keySchema: Schema.String,
      schema: Schema.Struct({ title: Schema.String }),
      client: { onError: MEMBERS_POLICY },
    },
  },
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A live-but-silent server stream (never yields, never ends), so a
 *  local-authority store stays seeded at its default (no server frame to reconcile). */
const emptyStream = (): Stream.Stream<unknown, unknown> => Stream.never;
/** A stream that FAILS the moment it is run — drives a subscription-drop. The
 *  failure is a plain `Error`, not an `RpcClientError`, so the face's retry fence
 *  refuses to retry it and it reaches the consumer once (`shouldRetryStreamError`). */
const rejectingStream = (msg: string) => (): Stream.Stream<unknown, unknown> =>
  Stream.fail(new Error(msg));

/** Build a stub DISPATCH over the surface's flat wire tags
 *  (`surface/<member>/<verb>`), with per-member stream/mutation behaviour
 *  overridable. `surfaceClient` builds the nested `surface.<member>.<verb>` face
 *  itself now, so the stub sits one layer down, at the tags. Modelled on
 *  `surfaceClient.readonly.test.ts`'s `stubDispatch`. */
function stubDispatch(
  over: {
    watchGet?: () => Stream.Stream<unknown, unknown>;
    prefsGet?: () => Stream.Stream<unknown, unknown>;
    prefsPatch?: () => Promise<void>;
    membersKeys?: () => Stream.Stream<unknown, unknown>;
  } = {},
): SurfaceDispatch {
  const noop = () => Promise.resolve();
  const streams: Record<string, () => Stream.Stream<unknown, unknown>> = {
    "surface/watch/get": over.watchGet ?? emptyStream,
    "surface/prefs/get": over.prefsGet ?? emptyStream,
    "surface/members/keys": over.membersKeys ?? emptyStream,
    "surface/members/get": emptyStream,
  };
  const unaries: Record<string, () => Promise<unknown>> = {
    "surface/prefs/patch": over.prefsPatch ?? noop,
    "surface/members/upsert": noop,
    "surface/members/delete": noop,
  };
  return {
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
}

/** A dispatch that answers every tag with silence — for the two CONSTRUCTION-time
 *  fail-fast tests, which throw before a single member is ever dispatched. */
const silentDispatch = (): SurfaceDispatch => ({
  unary: () => Effect.succeed(undefined),
  stream: () => Stream.never,
});

const live = () => true;

describe("SR11 client-policy dispatch — a declared policy reaches the interpreter", () => {
  it("(1a) a CELL's subscription error routes its declared policy VALUE + error to onClientError", async () => {
    const onClientError = vi.fn<OnClientError>();
    await createRoot(async (dispose) => {
      const app = buildSurfaceClient(
        surface,
        stubDispatch({ watchGet: rejectingStream("watch boom") }),
        live,
        onClientError,
      );
      app.cells.watch.use();
      await settle();
      // EXACT declared value (opaque to the framework) + the subscription error.
      expect(onClientError).toHaveBeenCalledTimes(1);
      const [policy, err] = onClientError.mock.calls[0]!;
      expect(policy).toBe(WATCH_POLICY);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/watch boom/);
      dispose();
    });
  });

  it("(1b) a COLLECTION's subscription error routes its declared policy VALUE + error to onClientError", async () => {
    const onClientError = vi.fn<OnClientError>();
    await createRoot(async (dispose) => {
      const app = buildSurfaceClient(
        surface,
        stubDispatch({ membersKeys: rejectingStream("keys boom") }),
        live,
        onClientError,
      );
      app.collections.members.use();
      await settle();
      expect(onClientError).toHaveBeenCalledTimes(1);
      const [policy, err] = onClientError.mock.calls[0]!;
      expect(policy).toBe(MEMBERS_POLICY);
      expect((err as Error).message).toMatch(/keys boom/);
      dispose();
    });
  });
});

describe("SR11 client-policy fail-fast — a declared policy with no interpreter CRASHES at construction", () => {
  it("(2) buildSurfaceClient THROWS when a member declares client.onError but no onClientError was threaded", () => {
    createRoot((dispose) => {
      expect(() =>
        // No fourth argument — the interpreter is absent, so a declared policy would
        // route nowhere (the silent-swallow defect the construction scan forbids).
        buildSurfaceClient(surface, stubDispatch(), live),
      ).toThrow(/no `onClientError` interpreter was threaded/);
      dispose();
    });
  });
});

describe("SR11 local-authority validity fail-fast (F1)", () => {
  it("(3) buildSurfaceClient THROWS for a get-only OBJECT cell declaring authority:'local'", () => {
    // Object value (so the local arm is spellable at the TYPE) but get-only (no
    // set/patch verb) — the verb dimension the type can't reflect, caught at construction.
    const getOnlyLocal = defineSurfaceWithPolicy<Policy>()({
      cells: {
        frozen: {
          schema: Schema.Struct({ n: Schema.Number }),
          default: { n: 0 },
          verbs: ["get"],
          client: { authority: "local" },
        },
      },
    });
    createRoot((dispose) => {
      expect(() =>
        // The construction scan runs BEFORE any member is dispatched, so a
        // silent dispatch is all this needs.
        buildSurfaceClient(getOnlyLocal, silentDispatch(), live),
      ).toThrow(/client\.authority "local" but is get-only/);
      dispose();
    });
  });

  it("(3-nonobject) buildSurfaceClient THROWS for a NON-object cell declaring authority:'local'", () => {
    // The `SurfaceSpec` constraint erases the cell value type to `any` at the
    // `defineSurfaceWithPolicy` call site, so a type gate can't drop the local arm where
    // the declaration is written — the runtime F1 scan is the SOLE enforcement for the
    // OBJECT dimension too. A primitive-valued local-authority store is unsound
    // (`createStore` needs an object), so it crashes at construction.
    const primitiveLocal = defineSurfaceWithPolicy<Policy>()({
      cells: {
        count: {
          schema: Schema.Number,
          default: 0,
          verbs: ["get", "set"],
          client: { authority: "local" },
        },
      },
    });
    createRoot((dispose) => {
      expect(() =>
        buildSurfaceClient(primitiveLocal, silentDispatch(), live),
      ).toThrow(/client\.authority "local" but is not object-valued/);
      dispose();
    });
  });
});

describe("SR11 dispatch cardinality — the policy fires per SUBSCRIPTION, not per consumer", () => {
  it("(4a) a shared-input CELL opened by N consumers dispatches the policy ONCE (shared slot)", async () => {
    const onClientError = vi.fn<OnClientError>();
    await createRoot(async (dispose) => {
      const app = buildSurfaceClient(
        surface,
        stubDispatch({ watchGet: rejectingStream("watch boom") }),
        live,
        onClientError,
      );
      // Three consumers of the SAME static-input cell → ONE deduped upstream sub.
      app.cells.watch.use();
      app.cells.watch.use();
      app.cells.watch.use();
      await settle();
      expect(onClientError).toHaveBeenCalledTimes(1);
      expect(onClientError.mock.calls[0]![0]).toBe(WATCH_POLICY);
      dispose();
    });
  });

  it("(4b) a whole-COLLECTION opened by N consumers dispatches the policy ONCE per slot", async () => {
    const onClientError = vi.fn<OnClientError>();
    await createRoot(async (dispose) => {
      const app = buildSurfaceClient(
        surface,
        stubDispatch({ membersKeys: rejectingStream("keys boom") }),
        live,
        onClientError,
      );
      app.collections.members.use();
      app.collections.members.use();
      await settle();
      expect(onClientError).toHaveBeenCalledTimes(1);
      expect(onClientError.mock.calls[0]![0]).toBe(MEMBERS_POLICY);
      dispose();
    });
  });
});

describe("SR11 spec-sourced local authority + failed flush", () => {
  it("(5) a bare .use() on a local-authority cell seeds from CellSpec.default AND routes a failed coalesced flush through the declared policy", async () => {
    const onClientError = vi.fn<OnClientError>();
    await createRoot(async (dispose) => {
      const app = buildSurfaceClient(
        surface,
        // The get stream is silent (store stays at default); the flush verb REJECTS.
        stubDispatch({
          prefsPatch: () => Promise.reject(new Error("flush boom")),
        }),
        live,
        onClientError,
      );
      // BARE .use() — no authority/initial/coalesceMs at the site: all sourced from
      // the spec's `client` block. The store seeds from `CellSpec.default`.
      const cell = app.cells.prefs.use();
      expect(cell.value()).toEqual({ size: 1 });

      // A coalesced write applies locally at once (the returned promise resolves on the
      // LOCAL apply, not the server ack) but defers the server flush by `coalesceMs`.
      await Effect.runPromise(cell.patch({ size: 2 }, { coalesce: true }));
      expect(cell.value()).toEqual({ size: 2 });
      expect(onClientError).not.toHaveBeenCalled();

      // After the coalesce window the deferred flush fires and REJECTS — routed through
      // the SAME declared policy (design §E: the one funnel serves sub-drop AND flush).
      await tick(60);
      expect(onClientError).toHaveBeenCalledTimes(1);
      const [policy, err] = onClientError.mock.calls[0]!;
      expect(policy).toBe(PREFS_POLICY);
      expect((err as Error).message).toMatch(/flush boom/);
      dispose();
    });
  });
});

// A cheap owner-presence assertion so a future refactor that moves `.use()` outside a
// reactive owner (breaking the shared-slot ownership) is caught here, not only in kolu.
describe("SR11 test harness sanity", () => {
  it("runs .use() inside a reactive owner", () => {
    createRoot((dispose) => {
      expect(getOwner()).not.toBeNull();
      dispose();
    });
  });
});
