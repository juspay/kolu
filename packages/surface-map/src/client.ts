/**
 * `connectSurfaceMap` — the CLIENT half. A typed map client whose `entries` is
 * the ONE membership authority (a bound `Collection<Key, EntryStatus>`), whose
 * `entry(key)` is a PURE lens (partial application of the key — no owner, no I/O,
 * total), and whose `useEntry(accessor)` is the Solid reactive lens that owns
 * swap disposal (a key change disposes the old key's subscriptions and rebuilds
 * synchronously).
 *
 * The per-key subtree is the runtime-keyed analogue of the compile-time sibling
 * client: a per-key `SurfaceClient<ES>` built over a `keyInjectingLink` — a Proxy
 * that folds `{ mapKey }` into every leaf call's input, so the base client (typed
 * against `ES`, with no `mapKey` in the consumer API) makes wire calls the server
 * reads as `{ mapKey, ...input }`. The base client's ref-counted dedup gives
 * per-key within-entry dedup for free (each per-key client has its own cache).
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { defineSurface } from "@kolu/surface/define";
import {
  buildSurfaceClient,
  createKeyedRoot,
  type ReadOnlyBoundCollection,
  resolveTransport,
  type SurfaceClient,
} from "@kolu/surface/solid";
import { type Accessor, createEffect, getOwner, runWithOwner } from "solid-js";
import type { z } from "zod";
import type { EntryStatus, SurfaceMap } from "./define";

// ── Entry & client shapes ───────────────────────────────────────────────

/** The entry-typed subtree PLUS a total existence-as-a-value fold over
 *  `entries`. Reuses the base `SurfaceClient<ES>`'s bound subtrees verbatim
 *  (`.cells`/`.collections`/`.streams`/`.events`). */
export interface Entry<ES extends SurfaceSpec>
  extends Pick<
    SurfaceClient<ES>,
    "cells" | "collections" | "streams" | "events"
  > {
  /** The entry surface's PROCEDURE client — for imperative point-calls
   *  (`entry(k).rpc.surface.<ns>.<verb>(input)`, the lifecycle/chrome/fs/git/… procs).
   *  The per-key link folds `{ mapKey }` into every call, so the consumer never passes
   *  the key. It is the per-key `SurfaceClient`'s `rpc` — typed as the map's `Rpc`
   *  (default `unknown` for the generic map, since the entry's link is untyped here); a
   *  consumer that knows its entry contract casts it (e.g. a `padiRpcOf` helper) or reads
   *  it through the concrete contract. Kept as `SurfaceClient<ES>["rpc"]` rather than a
   *  `ContractRouterClient<Surface<ES>["contract"]>` expansion, which is a TS2590
   *  "union too complex" under a generic `ES`. */
  readonly rpc: SurfaceClient<ES>["rpc"];
  /** The `EntryStatus` when a member, an explicit `not-a-member` value when not
   *  — a client fold over `entries`, total and never nullable. Read it inside a
   *  reactive scope (it subscribes to the membership collection). */
  state(): EntryStatus | { kind: "not-a-member" };
}

export interface SurfaceMapClient<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
> {
  /** The ONE membership authority, consumed as a normal bound collection. */
  readonly entries: ReadOnlyBoundCollection<z.infer<KS>, EntryStatus>;
  /** The app-transport liveness leg (resolved from the link once). A per-key chip
   *  must FLOOR its status claim on this — a stale `connected` over a silently
   *  half-open link is the #1568 lie. Constant-`true` for an in-process `directLink`;
   *  a websocket's watchdog otherwise. The per-key clients already fold it into their
   *  own `health().live`; this exposes it for the membership-strip UI. */
  readonly live: Accessor<boolean>;
  /** Sole producer of a branded key from a raw string (validates + brands). */
  parseKey(raw: string): z.infer<KS>;
  /** PURE lens — partial application of the key. No owner, no I/O, safe
   *  anywhere. Total. */
  entry(key: z.infer<KS>): Entry<ES>;
  /** Solid reactive lens — owns swap disposal (a keyed root disposes the old
   *  key's subscriptions on switch and rebuilds synchronously). THROWS outside a
   *  reactive owner. */
  useEntry(key: Accessor<z.infer<KS>>): Entry<ES>;
  dispose(): void;
}

// ── The key-injecting link ──────────────────────────────────────────────

/** Wrap a leaf call's input in the uniform fold envelope `{ mapKey, input }` — the
 *  map server reads `mapKey` and forwards `input` verbatim. Uniform across object,
 *  primitive, and undefined inputs (a no-input member sends `input: undefined`), and
 *  an entry input carrying its own `mapKey` field can't collide with the folded key
 *  (it rides `input`, nested). */
function foldMapKey(mapKey: unknown, input: unknown): unknown {
  return { mapKey, input };
}

/** A Proxy over `link` that folds `mapKey` into every `surface.<member>.<verb>`
 *  leaf call — so a per-key `SurfaceClient<ES>` built over it (typed against
 *  `ES`, no `mapKey`) issues wire calls the map server reads as
 *  `{ mapKey, ...input }`. */
function keyInjectingLink(link: unknown, mapKey: unknown): unknown {
  const surface = (link as { surface: Record<string, unknown> }).surface;
  return {
    surface: new Proxy(
      {},
      {
        get(_t, member: string) {
          // biome-ignore lint/suspicious/noExplicitAny: opaque oRPC client node walked by string
          const ns = surface[member] as any;
          return new Proxy(
            {},
            {
              get(_t2, verb: string) {
                const leaf = ns[verb] as (
                  input: unknown,
                  opts?: unknown,
                ) => unknown;
                return (input: unknown, opts?: unknown) =>
                  leaf(foldMapKey(mapKey, input), opts);
              },
            },
          );
        },
      },
    ),
  };
}

/** A reactive object whose every member delegates through `current()` — so a
 *  bound-primitive `.use()` result (all accessors/methods) re-reads the current
 *  key's result after a swap. */
function reactiveDelegate<R extends object>(current: Accessor<R>): R {
  return new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        return (...args: unknown[]) => {
          // biome-ignore lint/suspicious/noExplicitAny: delegating to the current result's accessor/method
          const target = current() as any;
          return target[prop](...args);
        };
      },
    },
  ) as R;
}

/** Build the reactive `Entry<ES>` `useEntry` returns: each bound-primitive
 *  `.use()` runs inside a keyed root over the accessor (so its subscriptions
 *  re-key on switch); imperative collection members (`upsert`/`delete`) delegate
 *  to the current key. */
function makeReactiveEntry<ES extends SurfaceSpec, K>(
  entryFor: (key: K) => Entry<ES>,
  keyAccessor: Accessor<K>,
): Entry<ES> {
  const primProxy = (prim: "cells" | "collections" | "streams" | "events") =>
    new Proxy(
      {},
      {
        get(_t, member: string) {
          return new Proxy(
            {},
            {
              get(_t2, verb: string) {
                if (verb === "use") {
                  return (...args: unknown[]) => {
                    const current = createKeyedRoot(keyAccessor, (key) => {
                      // biome-ignore lint/suspicious/noExplicitAny: dynamic member/verb walk over the bound subtree
                      const node = (entryFor(key) as any)[prim][member];
                      return node.use(...args) as object;
                    });
                    // Events' `.use()` returns void — keep the keyed root live
                    // (and re-keying) even when the caller never reads a result.
                    if (prim === "events") {
                      createEffect(() => {
                        current();
                      });
                      return undefined;
                    }
                    return reactiveDelegate(current);
                  };
                }
                // Imperative, lifecycle-free members (collection upsert/delete).
                return (...args: unknown[]) => {
                  // biome-ignore lint/suspicious/noExplicitAny: dynamic member/verb walk over the bound subtree
                  const node = (entryFor(keyAccessor()) as any)[prim][member];
                  return node[verb](...args);
                };
              },
            },
          );
        },
      },
    );
  // Cast the whole proxy-backed object at once (`as unknown as Entry<ES>`): the fields
  // are structurally satisfied by the proxies at runtime, and casting the object avoids
  // expanding `Entry<ES>["rpc"]`'s full contract-client union (a TS2590 "union too
  // complex" if cast per-field).
  return {
    cells: primProxy("cells"),
    collections: primProxy("collections"),
    streams: primProxy("streams"),
    events: primProxy("events"),
    rpc: rpcDelegate(entryFor, keyAccessor),
    state: () => entryFor(keyAccessor()).state(),
  } as unknown as Entry<ES>;
}

/** A path-walking proxy over an entry's `rpc` that reads the CURRENT key per call — so a
 *  procedure point-call through `useEntry` routes to the active host at call time (rare:
 *  procedures usually use the pure `entry()`, but this keeps `Entry.rpc` total). */
function rpcDelegate<ES extends SurfaceSpec, K>(
  entryFor: (key: K) => Entry<ES>,
  keyAccessor: Accessor<K>,
): unknown {
  const walk = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, prop) => walk([...path, prop as string]),
      apply: (_t, _this, args) => {
        // biome-ignore lint/suspicious/noExplicitAny: walk the current entry's rpc by the accumulated path
        let node: any = entryFor(keyAccessor()).rpc;
        for (const p of path) node = node[p];
        return node(...args);
      },
    });
  return walk([]);
}

// ── connectSurfaceMap ───────────────────────────────────────────────────

/** Connect a `SurfaceMap` over a link, producing the typed map client. The link's
 *  transport is resolved ONCE (via `resolveTransport`, which applies the half-open
 *  guard): the resolved `live` is threaded into the `entries` client AND every
 *  per-key client (each built over a key-injecting wrapper of the resolved link), so
 *  a per-key chip floors its status on real transport liveness — constant-`true`
 *  only for an in-process `directLink`, a watchdog otherwise. */
export interface ConnectSurfaceMapOptions {
  /** An explicit, already-resolved transport-liveness accessor — for FRAMEWORK
   *  COMPOSITION where `link` is a SCOPED slice of an already-guarded transport
   *  (e.g. `scopeSibling(conn.link, "padi")`, whose parent `connectSurfaces` already
   *  applied the half-open guard and owns the watchdog `live`). When given, `link` is
   *  used as-is with this `live` (the upstream guard is not re-applied); when omitted,
   *  the transport is resolved via `resolveTransport` (the half-open guard applies). */
  live?: Accessor<boolean>;
}

export function connectSurfaceMap<KS extends z.ZodType, ES extends SurfaceSpec>(
  map: SurfaceMap<KS, ES>,
  link: unknown,
  opts?: ConnectSurfaceMapOptions,
): SurfaceMapClient<KS, ES> {
  type K = z.infer<KS>;

  // Resolve the app transport ONCE → { resolvedLink, live }. Normally via
  // `resolveTransport` (the half-open guard: a bare wire link throws; a branded handle
  // yields its watchdog `live`; an in-process link yields constant-`true`). But
  // `opts.live` OVERRIDES it for framework composition — when `link` is a scoped slice
  // of an already-guarded transport, `resolveTransport` would wrongly give the bare
  // slice a constant-`true` leg, so the caller threads the parent's resolved `live`
  // against the slice directly (the guard already met upstream). The SAME `live`
  // threads into every client below so the live↔link pairing holds by construction.
  const { link: baseLink, live } = opts?.live
    ? { link, live: opts.live }
    : resolveTransport(link);

  // Capture the STABLE client owner: per-key clients' dedup caches must be
  // client-lifetime, never the transient `.use()`/mapArray owner that first
  // touches a key (a first-consumer owner is the leak class the cache kills).
  const clientOwner = getOwner();
  const build = <R>(fn: () => R): R => runWithOwner(clientOwner, fn) as R;

  const entriesSurface: Surface<{
    collections: { entries: typeof map.entriesSpec };
  }> = defineSurface({ collections: { entries: map.entriesSpec } });
  const entriesClient = build(() =>
    buildSurfaceClient(entriesSurface, baseLink, live),
  );
  const entries = entriesClient.collections.entries as ReadOnlyBoundCollection<
    K,
    EntryStatus
  >;

  const parseKey = (raw: string): K => map.keySchema.parse(raw) as K;

  // The pure lens' get-or-create: a per-key `SurfaceClient<ES>` cached by key.
  const clients = new Map<K, SurfaceClient<ES>>();
  const clientFor = (key: K): SurfaceClient<ES> => {
    let c = clients.get(key);
    if (!c) {
      c = build(() =>
        buildSurfaceClient(map.entry, keyInjectingLink(baseLink, key), live),
      ) as SurfaceClient<ES>;
      clients.set(key, c);
    }
    return c;
  };

  const foldState = (key: K): EntryStatus | { kind: "not-a-member" } => {
    const view = entries.use();
    if (!view.keys().some((k) => k === key)) return { kind: "not-a-member" };
    const v = view.byKey(key)?.() as EntryStatus | undefined;
    // A member whose per-key status frame hasn't landed yet is honestly warming.
    return v ?? { kind: "warming" };
  };

  const entry = (key: K): Entry<ES> => {
    const c = clientFor(key);
    return {
      cells: c.cells,
      collections: c.collections,
      streams: c.streams,
      events: c.events,
      // The per-key client's procedure client — its key-injecting link folds `{ mapKey }`
      // into every call. Typed loosely off the untyped link (`c.rpc` is `unknown`), so
      // cast to the entry-contract client `Entry.rpc` names.
      rpc: c.rpc as Entry<ES>["rpc"],
      state: () => foldState(key),
    };
  };

  const useEntry = (keyAccessor: Accessor<K>): Entry<ES> => {
    if (!getOwner()) {
      throw new Error(
        "connectSurfaceMap: useEntry(accessor) must run inside a reactive owner " +
          "— it owns swap disposal via a keyed root that disposes the old key's " +
          "subscriptions on switch. For a pure, owner-free lens use entry(key).",
      );
    }
    return makeReactiveEntry(entry, keyAccessor);
  };

  const dispose = () => {
    entriesClient.dispose();
    for (const c of clients.values()) c.dispose();
    clients.clear();
  };

  return { entries, live, parseKey, entry, useEntry, dispose };
}
