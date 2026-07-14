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
  type Subscription,
  type SurfaceClient,
} from "@kolu/surface/solid";
import {
  type Accessor,
  createEffect,
  getOwner,
  runWithOwner,
  untrack,
} from "solid-js";
import type { z } from "zod";
import type { EntryState, EntryStatus, KeyCodec, SurfaceMap } from "./define";
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
export interface Entry<ES extends SurfaceSpec, Failure = unknown> extends Pick<
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
  state(): EntryState<Failure>;
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
export function floorOnLiveness<Failure = unknown>(
  status: EntryState<Failure>,
  live: boolean,
): EntryState<Failure> {
  // Downgrade the CLAIM (connected → warming) but carry the entry's opaque
  // `membershipId` through untouched — the floor is about liveness, not identity, so
  // the demoted `warming` is still the SAME membership, keyed the same way (PR3).
  if (status.kind === "connected" && !live)
    return { kind: "warming", membershipId: status.membershipId };
  return status;
}

/** Floor a per-key `Subscription<EntryStatus>` on liveness with the SAME
 *  {@link floorOnLiveness} that floors `entry(key).state()` — applied here to the
 *  `entries` PROJECTION (the public membership collection), which otherwise re-exposes
 *  the server's RAW `connected` untouched (the #1568 green-over-dead lie, relocated
 *  from the per-entry lens to the membership collection a consumer actually reads,
 *  e.g. the host selector strip). `sub()` is `undefined` before the first frame lands
 *  — passed through as-is (there is no status yet to floor, and `byKey`'s contract is
 *  "undefined while pending", never a synthesized value). `floorOnLiveness` only ever
 *  DEMOTES a `connected` value it's handed (never introduces `not-a-member`), so the
 *  cast back to `EntryStatus` is sound. `pending`/`error`/`complete` pass through
 *  untouched — only the VALUE the subscription reports is floored. */
function floorEntrySubscription<Failure = unknown>(
  sub: Subscription<EntryStatus<Failure>>,
  live: Accessor<boolean>,
): Subscription<EntryStatus<Failure>> {
  return Object.assign(
    () => {
      const v = sub();
      return v === undefined
        ? undefined
        : (floorOnLiveness(v, live()) as EntryStatus<Failure>);
    },
    { pending: sub.pending, error: sub.error, complete: sub.complete },
  ) as Subscription<EntryStatus<Failure>>;
}

/** Build an {@link EntryClock} over a `state()` reader. `measureClockOffset` stamps
 *  `clockOffset = remoteEpoch − localEpoch` (same instant), so a remote-clock timestamp
 *  maps to this process's local clock by subtracting it. No `connected` status ⇒ no
 *  measured offset ⇒ `null` (never a silent identity). Failure-agnostic: it only ever
 *  reads `.kind`, never `.failure`, so it takes no `Failure` type param of its own. */
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
  Failure = unknown,
> {
  /** The ONE membership authority, consumed as a normal bound collection. */
  readonly entries: ReadOnlyBoundCollection<z.infer<KS>, EntryStatus<Failure>>;
  /** The app-transport liveness leg (resolved from the link once). A per-key chip
   *  must FLOOR its status claim on this — a stale `connected` over a silently
   *  half-open link is the #1568 lie. Constant-`true` for an in-process `directLink`;
   *  a websocket's watchdog otherwise. The per-key clients already fold it into their
   *  own `health().live`; this exposes it for the membership-strip UI. */
  readonly live: Accessor<boolean>;
  /** The map's key codec — the ONE key-identity authority. `scopedByEntry` (and
   *  any consumer keying its own per-entry structure off membership) folds a key
   *  to its canonical wire string through this rather than trusting `===`
   *  reference identity, which the client cannot guarantee across independent
   *  decodes of the same logical key (the map client's own cache vs. the caller's). */
  readonly codec: KeyCodec<z.infer<KS>>;
  /** PURE lens — partial application of the key. No owner, no I/O, safe
   *  anywhere. Total. */
  entry(key: z.infer<KS>): Entry<ES, Failure>;
  /** Solid reactive lens — owns swap disposal (a keyed root disposes the old
   *  key's subscriptions on switch and rebuilds synchronously). THROWS outside a
   *  reactive owner. */
  useEntry(key: Accessor<z.infer<KS>>): Entry<ES, Failure>;
  dispose(): void;
}

// ── The key-injecting link ──────────────────────────────────────────────

/** Wrap a leaf call's input in the uniform fold envelope `{ mapKey, input }` — the
 *  map server reads `mapKey` and forwards `input` verbatim. Uniform across object,
 *  primitive, and void inputs (a void-input member carries NO `input` field — just
 *  `{ mapKey }`), and an entry input carrying its own `mapKey` field can't collide with the folded key
 *  (it rides `input`, nested). `mapKey` is ALWAYS the canonical wire string here —
 *  the caller (`clientFor`) already ran the key through `map.codec.encode`. */
function foldMapKey(mapKey: string, input: unknown): unknown {
  return fold(mapKey, input);
}

/** A Proxy over `link` that folds the encoded `mapKey` STRING into every
 *  `surface.<member>.<verb>` leaf call — so a per-key `SurfaceClient<ES>` built
 *  over it (typed against `ES`, no `mapKey`) issues wire calls the map server
 *  reads as `{ mapKey, ...input }`. */
function keyInjectingLink(link: unknown, mapKey: string): unknown {
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

/** Delegate a reactive result that IS a canonical {@link Subscription} — callable
 *  (the primary read path) AND carrying `.pending`/`.error`/`.complete` accessor
 *  properties. Typed AS `Subscription<T>` (not re-spelled by ad-hoc `pending`/`error`
 *  string literals guessed independently), so a future field the upstream type gains is a
 *  compile error HERE too, not a silent drop. Shared by `reactiveDelegate`'s `.sub`
 *  case (a cell/collection's nested Subscription) and a stream's WHOLE `.use()`
 *  result (`makeReactiveEntry`'s `prim === "streams"` branch below) — the two
 *  places a `useEntry` consumer can hit a re-keyed Subscription.
 *
 *  `complete` is OPTIONAL on `Subscription<T>` (a hand-assembled non-factory
 *  Subscription can legitimately omit it), so forwarding it can't be a bare
 *  `current().complete()` — that would throw the instant a re-key lands on one
 *  that omits it. `?.() ?? false` is not a fallback for a MISSING fact (every
 *  Subscription this delegate actually re-keys — cells/collections/streams built
 *  through `@kolu/surface/solid` — populates it), it is the SHAPE `Accessor<boolean>`
 *  demands: the property, once present, must always resolve to a real boolean. */
function delegateSubscription<T>(
  current: Accessor<Subscription<T>>,
): Subscription<T> {
  return Object.assign(() => current()(), {
    pending: () => current().pending(),
    error: () => current().error(),
    complete: () => current().complete?.() ?? false,
    // NO `updated` here — deliberately left absent (it is OPTIONAL on
    // `Subscription<T>`, so the type is still satisfied). `updated` carries a hard
    // law (a differing frame fires exactly once with the true `prev`); a delegated
    // re-keyed sub CANNOT honor it — across a re-key the registration ends on the
    // old sub and the fresh sub's first frame is a value, not a change, so a
    // genuine host-switch value change would be silently dropped. A present-but-
    // law-violating `updated` is worse than its absence: absence steers any
    // consumer that needs honest change pairs onto the `entry(key)` path (what
    // `watchByEntry` does), which hands back the base sub untouched. If
    // "changes of the currently-viewed entry" is ever genuinely wanted, give it a
    // distinct documented name rather than overloading the law-bearing `updated`.
  }) as Subscription<T>;
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
          return delegateSubscription(
            () => (current() as unknown as { sub: Subscription<unknown> }).sub,
          );
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
 *  `.use()` runs inside a keyed root over `reKeyIdentity` — the `{enc, membershipId}`
 *  identity — so its subscriptions re-key on an active-key SWITCH *and* on a same-key
 *  re-add / authority restart (a new membershipId), the two paths PR3 makes rebuild by
 *  construction. Imperative collection members (`upsert`/`delete`) and procedures
 *  delegate to the current key (one-shot — no membership-fresh client needed). */
function makeReactiveEntry<ES extends SurfaceSpec, K, Failure = unknown>(
  entryFor: (key: K) => Entry<ES, Failure>,
  keyAccessor: Accessor<K>,
  reKeyIdentity: (key: K) => string,
): Entry<ES, Failure> {
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
                    const current = createKeyedRoot(
                      // The keyed root re-keys on the {enc, membershipId} identity: an
                      // active-key switch changes `enc`, a re-add/restart changes the id —
                      // either disposes the old sub and opens a fresh one (over the fresh
                      // per-key client `entryFor` selects for the current id).
                      () => reKeyIdentity(keyAccessor()),
                      () => {
                        const key = untrack(keyAccessor);
                        // biome-ignore lint/suspicious/noExplicitAny: dynamic member/verb walk over the bound subtree
                        const node = (entryFor(key) as any)[prim][member];
                        return node.use(...args) as object;
                      },
                    );
                    // Events' `.use()` returns void — keep the keyed root live
                    // (and re-keying) even when the caller never reads a result.
                    if (prim === "events") {
                      createEffect(() => {
                        current();
                      });
                      return undefined;
                    }
                    // `BoundStream.use()`'s WHOLE result IS a `Subscription<T>` (unlike
                    // cells/collections, whose `.use()` result is a plain object with a
                    // NESTED `.sub` Subscription) — `reactiveDelegate`'s blanket wrapper
                    // only handles property reads, never making the delegate itself
                    // callable, so `entry.streams.<s>.use()()` would throw. Delegate the
                    // top-level result the same way `.sub` is delegated above.
                    if (prim === "streams") {
                      return delegateSubscription(
                        current as unknown as Accessor<Subscription<unknown>>,
                      );
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
  } as unknown as Entry<ES, Failure>;
}

/** A path-walking proxy over an entry's `rpc` that reads the CURRENT key per call — so a
 *  procedure point-call through `useEntry` routes to the active host at call time (rare:
 *  procedures usually use the pure `entry()`, but this keeps `Entry.rpc` total). */
function rpcDelegate<ES extends SurfaceSpec, K, Failure = unknown>(
  entryFor: (key: K) => Entry<ES, Failure>,
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
 *  a combined socket, the map's sibling is sliced by `map.name` from the WHOLE handle), or
 *  a bare in-process `directLink` (constant-`true`). A bare half-open wire link THROWS — a
 *  raw `{ live: () => true }` over a dead transport is unspellable (#1564).
 *
 *  The transport-slice key is `map.name` (PR3): a map DECLARED with a mount name (kolu's
 *  `"padi"`, drishti's `"hosts"`) is sliced from the combined transport by that name, so
 *  the connection site passes NO stringly sibling key — the key derives from the
 *  declaration. A nameless map (the in-process harness) is served at the transport root
 *  and is not sliced. */
export function connectSurfaceMap<
  KS extends z.ZodType,
  ES extends SurfaceSpec,
  Failure = unknown,
>(
  map: SurfaceMap<KS, ES, Failure>,
  transport: unknown,
): SurfaceMapClient<KS, ES, Failure> {
  type K = z.infer<KS>;

  // Resolve the transport ONCE — the guard is the ONLY way in: a branded
  // `LiveSignalHandle` yields its watchdog `live` + link; a bare half-open wire link
  // THROWS; an in-process `directLink` yields constant-`true`. For framework composition
  // over a SIBLING of a combined transport (kolu's `padi` sibling of `conn.transport`),
  // pass the whole branded handle + `siblingKey`: the sibling is sliced from the resolved
  // link AFTER the guard, so it inherits the PARENT's watchdog `live` by construction —
  // there is no bare slice paired with a fabricated accessor.
  // connectSurfaceMap OWNS the slicing (by `map.name`), so `transport` must be the
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
        "from connectSurfaces) — or an in-process `directLink`. A pre-sliced " +
        "or bare wire link cannot carry the half-open watchdog live; its by-exclusion " +
        "constant-`true` liveness would floor a green chip over a dead transport (#1564 / #1580).",
    );
  }
  const { link: fullLink, live } = resolveTransport(transport);
  // The transport-slice key derives from the map DECLARATION (`map.name`), never a
  // caller-passed string (PR3). A named map is a sibling of the combined transport and is
  // sliced by that name; a nameless map is served at the root and is not sliced.
  const baseLink =
    map.name !== undefined ? scopeSibling(fullLink, map.name) : fullLink;

  // Capture the STABLE client owner: per-key clients' dedup caches must be
  // client-lifetime, never the transient `.use()`/mapArray owner that first
  // touches a key (a first-consumer owner is the leak class the cache kills).
  const clientOwner = getOwner();
  const build = <R>(fn: () => R): R => runWithOwner(clientOwner, fn) as R;

  // The membership collection's WIRE shape is ALWAYS string-keyed (`map.entriesSpec`,
  // define.ts) — `rawEntries` is that raw bound collection. The map's OWN `K` may be a
  // non-primitive (kolu's `HostKey`), so every membership/dedup/cache operation below
  // works in STRING space (via `map.codec.encode`) and only decodes to `K` at the
  // external `entries` field consumers read for `.kind`-switching (below).
  const entriesSurface: Surface<{
    collections: { entries: typeof map.entriesSpec };
  }> = defineSurface({ collections: { entries: map.entriesSpec } });
  const entriesClient = build(() =>
    buildSurfaceClient(entriesSurface, baseLink, live),
  );
  const rawEntries = entriesClient.collections
    .entries as ReadOnlyBoundCollection<string, EntryStatus<Failure>>;

  // A key object has NO reference identity of its own (two independent decodes of
  // the same wire string are logically equal but never `===` — zod's `.parse`
  // mints a fresh object even for an already-valid input). Every consumer that
  // needs IDENTITY-keyed reconciliation (Solid's `<For>` over `entries.use().keys()`,
  // `useEntry`'s `createKeyedRoot` swap-root, which `mapArray`-keys by `===`) leans
  // on ONE canonical reference per encoded string instead of re-deriving its own —
  // so a same-key new-reference write (e.g. re-parsing "local" into a fresh HostKey
  // object) can never look like a key CHANGE. Evicted alongside the departed-member
  // prune below so a long-lived client doesn't accumulate one entry per distinct
  // key ever seen.
  const keyCache = new Map<string, K>();
  const canonicalizeKey = (key: K): K => {
    const enc = map.codec.encode(key);
    const cached = keyCache.get(enc);
    if (cached !== undefined) return cached;
    keyCache.set(enc, key);
    return key;
  };

  /** Decode + re-validate a wire string into `K` — the P5 gate (a foreign string a
   *  server somehow published must fail here, not silently become a trusted `K`) —
   *  then canonicalize it to the one stable reference for its encoded string. */
  const decodeKey = (wire: string): K =>
    canonicalizeKey(map.keySchema.parse(map.codec.decode(wire)) as K);

  // The external, OBJECT-keyed membership view (`SurfaceMapClient.entries`) — a thin
  // projection of `rawEntries` that encodes a caller's `keys` override going in and
  // decodes the string keyset coming out, so a consumer (kolu's host-reconcile effect,
  // the selector strip) can `.kind`-switch the members it reads. `decodeKey`'s
  // canonicalization means an UNCHANGED member yields the SAME `K` reference across
  // calls, so a reference-keyed `<For>` reconciles only a genuinely changed row.
  const entries: ReadOnlyBoundCollection<K, EntryStatus<Failure>> = {
    use(opts) {
      const rawKeys = opts?.keys
        ? () => opts.keys?.().map((k) => map.codec.encode(k)) ?? []
        : undefined;
      const result = rawEntries.use({ keys: rawKeys, onError: opts?.onError });
      return {
        keys: () => result.keys().map(decodeKey),
        byKey: (key: K) => {
          const sub = result.byKey(map.codec.encode(key));
          return sub === undefined
            ? undefined
            : floorEntrySubscription(sub, live);
        },
      };
    },
  };

  // The published `membershipId` for a key, read off the membership collection
  // (PR3). TRACKED when read inside a reactive scope (the re-key driver in
  // `makeReactiveEntry`); `undefined` before the first status frame lands, or for a
  // key that is not a member. Callers that must stay non-reactive (`entry`'s pure
  // lens) read it through `untrack`.
  const membershipIdOf = (key: K): string | undefined => {
    const enc = map.codec.encode(key);
    const view = rawEntries.use();
    if (!view.keys().includes(enc)) return undefined;
    return (view.byKey(enc)?.() as EntryStatus<Failure> | undefined)
      ?.membershipId;
  };

  // The opaque re-key identity composite — `enc` + NUL + `membershipId` (NUL can't
  // occur in a wire string, so the two fields can't alias). It NO LONGER keys the
  // client cache (that is now the nested `clients` map below, keyed structurally by
  // enc then id): it only builds the string `reKeyIdentity` a keyed root diffs to
  // decide when to rebuild its sub, and is NEVER re-parsed. An empty id is the PENDING
  // slot (no status frame yet / a non-reactive pure-lens caller).
  const KEY_SEP = "\u0000";
  const clientCacheKey = (
    enc: string,
    membershipId: string | undefined,
  ): string => `${enc}${KEY_SEP}${membershipId ?? ""}`;

  // The pure lens' get-or-create: a per-key `SurfaceClient<ES>` cached by
  // `{encodedKey, membershipId}` (PR3) — NEVER the enc alone. The identity pair is held
  // STRUCTURALLY as a nested `Map<enc, Map<membershipId, client>>` (`'' = pending`), so
  // enc-departure pruning and same-enc eviction are map operations, not substring
  // surgery on a delimited key. A same-key remove/re-add mints a NEW id server-side, and
  // an authority restart mints new ids for every member, so either way this cache MISSES
  // and builds a FRESH client (fresh dedup cache → fresh subscriptions) rather than
  // resurrecting the stale one — the rebuild kolu's hand-rolled `createRejoinKeyedSub`
  // used to force, now by construction. The enc (not the raw `K`) is the outer string
  // key because a JS `Map`/`===` compares objects by reference, so two logically-equal
  // `HostKey`s from independent decodes would otherwise never dedup to one client.
  const clients = new Map<string, Map<string, SurfaceClient<ES>>>();
  const clientFor = (
    key: K,
    membershipId: string | undefined,
  ): SurfaceClient<ES> => {
    const enc = map.codec.encode(key);
    const id = membershipId ?? "";
    let inner = clients.get(enc);
    if (inner === undefined) {
      inner = new Map<string, SurfaceClient<ES>>();
      clients.set(enc, inner);
    }
    let c = inner.get(id);
    if (!c) {
      c = build(() =>
        buildSurfaceClient(map.entry, keyInjectingLink(baseLink, enc), live),
      ) as SurfaceClient<ES>;
      inner.set(id, c);
      // A REAL id supersedes every prior client for THIS enc — the `#pending` slot AND
      // any older-id client left by a re-add / authority restart — so dispose them the
      // instant the authoritative client is built (the keyed root has already re-keyed its
      // sub onto this one). A PENDING build (undefined id) supersedes nothing: it must
      // never kill the authoritative real-id client. Reaping a superseded-id client HERE is
      // what lets the departed-membership effect below read only the KEYSET, never opening
      // a per-key status sub for every member just to notice an id changed.
      if (membershipId !== undefined) {
        for (const [otherId, otherClient] of [...inner]) {
          if (otherId !== id) {
            otherClient.dispose();
            inner.delete(otherId);
          }
        }
      }
    }
    return c;
  };

  // Prune cached per-key clients whose ENC has DEPARTED membership (PR3) — the
  // client-side twin of the server's `reServeEviction.pruneToMembers`. A key that leaves
  // membership has had its subs typed-ended by the server, so disposing every cached
  // client under that enc (across all its membershipIds) is safe cleanup; the next
  // entry(key)/useEntry rebuilds on demand. SUPERSEDED-id cleanup for a STILL-present enc
  // (a re-add without an intervening departure, an authority restart) is NOT done here —
  // `clientFor`'s real-id eviction above reaps it — so this effect reads only the KEYSET
  // (`keys()`), never per-key `byKey`, and therefore does NOT eagerly open a status sub
  // for every member (which would change laziness and light every member's stream). The
  // `keyCache` (the per-enc canonical reference for `<For>` stability) is likewise pruned
  // on enc departure ONLY: a re-add reuses the same wire spelling and keeps the same row
  // reference, so it is deliberately NOT tied to the membershipId. Runs in the client
  // owner (client-lifetime, like the caches); compares RAW encoded strings, side-stepping
  // the object-identity trap `K` itself would set.
  build(() => {
    let prevMembers: string[] = [];
    createEffect(() => {
      const members = rawEntries.use().keys();
      const present = new Set(members);
      for (const enc of [...clients.keys()]) {
        if (!present.has(enc)) {
          for (const c of clients.get(enc)?.values() ?? []) c.dispose();
          clients.delete(enc);
        }
      }
      for (const enc of prevMembers) {
        if (!present.has(enc)) keyCache.delete(enc);
      }
      prevMembers = members;
    });
  });

  const foldState = (key: K): EntryState<Failure> => {
    const view = rawEntries.use();
    const enc = map.codec.encode(key);
    if (!view.keys().includes(enc)) return { kind: "not-a-member" };
    const v = view.byKey(enc)?.() as EntryStatus<Failure> | undefined;
    // A member whose per-key status frame hasn't landed yet is honestly warming; then
    // FLOOR the claim on the map's OWN transport liveness via {@link floorOnLiveness}: a
    // server-published "connected" over a dead/half-open link (`live() === false`) can no
    // longer hear a demotion, so it downgrades to warming rather than presenting green over
    // a dead transport (#1568 — the per-key chip that paints `state()` inherits the floor
    // for free). An in-process `directLink` can't half-open so its `live()` is a constant
    // true and never floors. This is the flooring `hostChipTone`'s docstring asserts, in code.
    //
    // The pre-frame synthesized warming carries an EMPTY `membershipId` (PR3): the id
    // rides ON the status, so a member seen in the keyset before its first status frame
    // has none yet. It is never used for keying — the per-key client keys off
    // `membershipIdOf` (the RAW status, `undefined` here), not this display value — and no
    // consumer reads `membershipId` off `state()`; it is the arm's required field made
    // total for the transient pre-frame gap, replaced by the real id on the next frame.
    return floorOnLiveness(v ?? { kind: "warming", membershipId: "" }, live());
  };

  const entry = (key: K): Entry<ES, Failure> => {
    // Key the per-key client on the CURRENT {enc, membershipId} (PR3). Read the id only
    // inside a reactive owner — the `useEntry` / reactive-`.use()` path, whose keyed root
    // (`reKeyIdentity`) drives the rebuild on a re-add/restart — and read it UNTRACKED, so
    // this build adds no second dependency to the sub's owner (the keyed identity is the
    // one tracked read). A non-reactive pure-lens caller (an imperative procedure
    // point-call) stays owner-free and total: `undefined` selects the `#pending` client,
    // which routes identically since the wire folds the key by `enc`, never the id.
    const membershipId = getOwner()
      ? untrack(() => membershipIdOf(key))
      : undefined;
    const c = clientFor(key, membershipId);
    return {
      cells: c.cells,
      collections: c.collections,
      streams: c.streams,
      events: c.events,
      // The per-key client's procedure client — its key-injecting link folds `{ mapKey }`
      // into every call. Typed loosely off the untyped link (`c.rpc` is `unknown`), so
      // cast to the entry-contract client `Entry.rpc` names.
      rpc: c.rpc as Entry<ES, Failure>["rpc"],
      clock: makeEntryClock(() => foldState(key)),
      state: () => foldState(key),
    };
  };

  const useEntry = (keyAccessor: Accessor<K>): Entry<ES, Failure> => {
    if (!getOwner()) {
      throw new Error(
        "connectSurfaceMap: useEntry(accessor) must run inside a reactive owner " +
          "— it owns swap disposal via a keyed root that disposes the old key's " +
          "subscriptions on switch. For a pure, owner-free lens use entry(key).",
      );
    }
    // Canonicalize the accessor's key by its encoded string BEFORE it reaches
    // `createKeyedRoot` — `mapArray` keys its single-element array by `===`, so a
    // same-key new-reference write (a no-op click re-parsing "local" into a fresh
    // HostKey object) would otherwise dispose and rebuild every subscription under
    // this swap-root for no membership change at all. `canonicalizeKey` guarantees
    // one reference per encoded string map-wide, so the read below is a no-op read,
    // never a key change.
    const stableKey = () => canonicalizeKey(keyAccessor());
    // The re-key identity the keyed root switches on: the per-key client's
    // `{enc, membershipId}` cache key. Reads `membershipIdOf` TRACKED (this runs inside
    // the keyed root's key accessor, a tracking scope), so the root re-keys on an
    // active-key switch (enc changes) AND on a same-key re-add / authority restart (the
    // published id changes) — the two rebuild paths PR3 guarantees.
    //
    // A sub opened BEFORE its first membership frame keys on the `#pending` id, then
    // re-keys once when the real id lands — one extra subscribe+teardown at cold start.
    // That is on-screen-neutral (the cell reads warming throughout the gap either way) and
    // the price of a single, uniform rule that also rebuilds correctly on remove/re-add;
    // keying it away would take a generation counter whose bookkeeping fights the
    // departed-membership prune for no user-visible gain.
    const reKeyIdentity = (key: K): string =>
      clientCacheKey(map.codec.encode(key), membershipIdOf(key));
    return makeReactiveEntry(entry, stableKey, reKeyIdentity);
  };

  const dispose = () => {
    entriesClient.dispose();
    for (const inner of clients.values())
      for (const c of inner.values()) c.dispose();
    clients.clear();
  };

  return { entries, live, codec: map.codec, entry, useEntry, dispose };
}

// `scopedByEntry` (lazy per-key state owned by membership) and `watchByEntry`
// (the eager per-member attention watcher) — one shared membership kernel, two
// laziness policies. Both live here on the inherently-Solid
// `@kolu/surface-map/client` entrypoint (the package has no separate `/solid`
// subpath by design — see index.ts).
export {
  type ScopedByEntry,
  scopedByEntry,
  type WatchByEntry,
  watchByEntry,
  type WatchedValue,
} from "./scoped";
