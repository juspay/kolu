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
import { defineSurface, scopeSibling } from "@kolu/surface/define";
import { isDirectLink } from "@kolu/surface/links/direct";
import {
  buildSurfaceClient,
  createKeyedRoot,
  isLiveSignalHandle,
  type ReadOnlyBoundCollection,
  resolveTransport,
  type SurfaceClient,
} from "@kolu/surface/solid";
import { type Accessor, createEffect, getOwner, runWithOwner } from "solid-js";
import type { z } from "zod";
import type { EntryState, EntryStatus, SurfaceMap } from "./define";
import { fold } from "./envelope";

// ── Entry & client shapes ───────────────────────────────────────────────

/** The map's total displayed-entry state — a total existence-as-a-value fold over `entries`
 *  (the {@link EntryStatus} when a member + the explicit `not-a-member` value `state()` returns
 *  when not). DEFINED in `./define` (the solid-free contract module) so a node consumer that
 *  re-exports it type-only via `index.ts` never pulls the Solid client; re-exported here so
 *  `@kolu/surface-map/client` importers keep resolving it. */
export type { EntryState };

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
  /** The clock-translation lens — reproject a far-end (remote-host) timestamp into THIS
   *  process's local clock using the entry's measured `clockOffset`. The ONE generic
   *  translation the map exposes; WHICH fields are host-stamped is the consumer's domain
   *  knowledge (it routes its known host-stamped reads through this). */
  readonly clock: EntryClock;
  /** The `EntryStatus` when a member, an explicit `not-a-member` value when not
   *  — a client fold over `entries`, total and never nullable. Read it inside a
   *  reactive scope (it subscribes to the membership collection). */
  state(): EntryState;
}

/** The entry's clock translation (see {@link Entry.clock}). */
export interface EntryClock {
  /** A remote-host epoch-ms → this process's LOCAL-clock epoch-ms, via the entry's
   *  offset-at-hello `clockOffset`. Returns `null` when the entry has no offset yet
   *  (`warming` / `failed` / `not-a-member`) — the caller MUST handle it (render a
   *  pending "—"), NEVER falling back to the raw remote value (that is the silent
   *  foreign-clock identity this lens exists to prevent). Read inside a reactive scope:
   *  it folds the membership collection, so it re-answers as the entry connects. */
  toLocal(remoteMs: number): number | null;
}

/** The liveness floor `foldState` applies to a per-key status, extracted PURE so the
 *  decision is unit-pinnable without a half-openable transport (a `directLink` is
 *  constant-live and a `LiveSignalHandle` is un-forgeable, so the dead-link branch is
 *  otherwise unreachable from a test). A server-published `connected` is only as
 *  trustworthy as OUR link to the publisher: with that link dead (`live === false`) we
 *  can no longer hear a demotion, so a stale `connected` must NOT keep presenting as
 *  connected — it downgrades to `warming` (#1568: no status renders green over a dead
 *  transport). Every other status (`failed` / `warming` / `not-a-member`) is already
 *  honest and passes through untouched, and a live link is a no-op. Making `live` a
 *  REQUIRED argument is the point: `foldState` cannot forget to floor. */
export function floorOnLiveness(status: EntryState, live: boolean): EntryState {
  if (status.kind === "connected" && !live) return { kind: "warming" };
  return status;
}

/** Build an {@link EntryClock} over a `state()` reader. `measureClockOffset` stamps
 *  `clockOffset = remoteEpoch − localEpoch` (same instant), so a remote-clock timestamp
 *  maps to this process's local clock by subtracting it. No `connected` status ⇒ no
 *  measured offset ⇒ `null` (never a silent identity). */
function makeEntryClock(getState: () => EntryState): EntryClock {
  return {
    toLocal(remoteMs: number): number | null {
      const s = getState();
      if (s.kind !== "connected") return null;
      return remoteMs - s.clockOffset;
    },
  };
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
  return fold(mapKey, input);
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
        // `.sub` is itself a `Subscription` — an accessor that ALSO carries `.pending`
        // /`.error` accessor PROPERTIES (createSubscription). The blanket method-wrapper
        // below would model it as a bare callable and DROP those nested accessors, so
        // `entry.cells.X.use().sub.pending()` would throw. Delegate `.sub` AS a
        // Subscription (callable + `.pending`/`.error`) so its full shape survives the
        // re-key, matching the `Entry` type the outer cast promises.
        if (prop === "sub") {
          // biome-ignore lint/suspicious/noExplicitAny: delegating the current result's Subscription
          const subOf = () => (current() as any).sub;
          return Object.assign((...args: unknown[]) => subOf()(...args), {
            pending: () => subOf().pending(),
            error: () => subOf().error(),
          });
        }
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
    clock: makeEntryClock(() => entryFor(keyAccessor()).state()),
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

/** Connect a `SurfaceMap` over a transport, producing the typed map client. The
 *  transport is resolved ONCE (via `resolveTransport`, the ONLY liveness source — there
 *  is NO `{ live }` override seam): the resolved `live` threads into the `entries` client
 *  AND every per-key client (each built over a key-injecting wrapper of the resolved
 *  link), so a per-key chip floors its status on real transport liveness.
 *
 *  `transport` is either a BRANDED `LiveSignalHandle` (a websocket's watchdog live — for
 *  a combined socket, pass the WHOLE handle + `siblingKey` to slice the map's sibling),
 *  or a bare in-process `directLink` (constant-`true`). A bare half-open wire link THROWS
 *  — a raw `{ live: () => true }` over a dead transport is unspellable (#1564). */
export function connectSurfaceMap<KS extends z.ZodType, ES extends SurfaceSpec>(
  map: SurfaceMap<KS, ES>,
  transport: unknown,
  siblingKey?: string,
): SurfaceMapClient<KS, ES> {
  type K = z.infer<KS>;

  // Resolve the transport ONCE — the guard is the ONLY way in: a branded
  // `LiveSignalHandle` yields its watchdog `live` + link; a bare half-open wire link
  // THROWS; an in-process `directLink` yields constant-`true`. For framework composition
  // over a SIBLING of a combined transport (kolu's `padi` sibling of `conn.transport`),
  // pass the whole branded handle + `siblingKey`: the sibling is sliced from the resolved
  // link AFTER the guard, so it inherits the PARENT's watchdog `live` by construction —
  // there is no bare slice paired with a fabricated accessor.
  // connectSurfaceMap OWNS the slicing (via `siblingKey`), so `transport` must be the
  // BRANDED parent handle (a `LiveSignalHandle`, whose watchdog `live` the sliced sibling
  // inherits) or an in-process `directLink` (sound constant-`true`). A RAW PRE-SLICED wire
  // link — `scopeSibling(conn.link, "padi")` — or any other unbranded wire link is a
  // MISUSE: `scopeSibling` re-wraps, stripping the half-open brand, so its liveness would
  // fall to `resolveTransport`'s by-exclusion constant-`true` and floor every chip GREEN
  // over a genuinely half-openable socket (#1564). Reject it loudly so THIS api cannot
  // express that lie. (The framework-wide brand-propagation through `scopeSibling` — so a
  // scoped WIRE slice still throws everywhere — is #1580's own fix, not this PR's; this
  // guards connectSurfaceMap's own door.)
  if (!isLiveSignalHandle(transport) && !isDirectLink(transport)) {
    throw new Error(
      "connectSurfaceMap: pass the BRANDED parent transport handle (e.g. `conn.transport` " +
        "from connectSurfaces) + a siblingKey — or an in-process `directLink`. A pre-sliced " +
        "or bare wire link cannot carry the half-open watchdog live; its by-exclusion " +
        "constant-`true` liveness would floor a green chip over a dead transport (#1564 / #1580).",
    );
  }
  const { link: fullLink, live } = resolveTransport(transport);
  const baseLink =
    siblingKey !== undefined ? scopeSibling(fullLink, siblingKey) : fullLink;

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

  // Prune a DEPARTED host's cached per-key client — the client-side twin of the server's
  // `reServeEviction.pruneToMembers`. A key that LEAVES membership has had its subs typed-ended
  // by the server, so disposing its cached client is safe cleanup; the next entry(key)/useEntry
  // rebuilds one on demand. Tracks the PREVIOUS member set (not merely "not a member"), so an
  // `entry(key)` lens a consumer holds for a never-member key is never touched — only a host that
  // WAS a member and then left. Runs in the client owner (client-lifetime, like the caches).
  build(() => {
    let prevMembers: K[] = [];
    createEffect(() => {
      const members = entries.use().keys();
      for (const key of prevMembers) {
        if (!members.includes(key)) {
          clients.get(key)?.dispose();
          clients.delete(key);
        }
      }
      prevMembers = members;
    });
  });

  const foldState = (key: K): EntryState => {
    const view = entries.use();
    if (!view.keys().some((k) => k === key)) return { kind: "not-a-member" };
    const v = view.byKey(key)?.() as EntryStatus | undefined;
    // A member whose per-key status frame hasn't landed yet is honestly warming; then
    // FLOOR the claim on the map's OWN transport liveness via {@link floorOnLiveness}: a
    // server-published "connected" over a dead/half-open link (`live() === false`) can no
    // longer hear a demotion, so it downgrades to warming rather than presenting green over
    // a dead transport (#1568 — the per-key chip that paints `state()` inherits the floor
    // for free). An in-process `directLink` can't half-open so its `live()` is a constant
    // true and never floors. This is the flooring `hostChipTone`'s docstring asserts, in code.
    return floorOnLiveness(v ?? { kind: "warming" }, live());
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
      clock: makeEntryClock(() => foldState(key)),
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
