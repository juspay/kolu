# @kolu/surface-map — Phase 1 public API (design draft, pre-checkpoint)

Grounded in: the accepted spec (`remote-surfaces.mdx`), the 3-agent debate record, and a
ground-truth read of `@kolu/surface` (dedup seam), `@kolu/surface-remote` (resolver seam),
`padiSurface` (entry spec), `createSingletonRoot@1.5.3` (verified source), and the #1708 pins.

This draft nails the signatures + the lifetime contract, and marks the **three decisions the
brief flagged to consult on** (branded key · dedup lifetime · resolver seam) with a recommendation
each. It is the pre-build design; the checkpoint report (after build) is the *realized* API.

---

## Layer 0 — `@kolu/surface` (base): ref-counted subscription dedup

**Where.** A new per-client keyed cache created inside `buildSurfaceClient`
(`solid/surfaceClient.ts:605`), right beside the health registry (`:617`). It is the client's
structural twin: both are per-`link` (two sockets must never share a slot) and the funnel every
static-input `.use()` already passes through.

```ts
// solid/keyedSubscriptionCache.ts  (new)
interface KeyedSubscriptionCache {
  /** Get-or-create the ONE shared subscription for this (proc-path, static-input) identity.
   *  Ref-counted per reactive listener via createSingletonRoot; the shared root is owned by the
   *  CLIENT (passed explicitly — never the first consumer). Returns the shared Subscription. */
  use<T>(cacheKey: string, make: () => Subscription<T>): Subscription<T>;
}
function createKeyedSubscriptionCache(clientOwner: Owner | null): KeyedSubscriptionCache;
```

**Cache key** = `` `${descriptorKey}/${prim}/${verb}#${stableHash(input)}` `` — the stable wire path
plus a stable-stringify of the *zod-validated static input* (`undefined` for cells/keys/deltas; the
per-key value for collection items; the **branded key is part of the input for a map entry**, so the
map inherits keyed dedup for free). `stableHash` throws on functions (the risk the spec names).

**Slot** = `createSingletonRoot(() => { …make()… }, clientOwner)`. Verified semantics we rely on:
- ref-count is per-listener; each consumer's `.use()` calls the slot under its own owner, so
  disposal is automatic when the last consumer leaves;
- teardown is **microtask-deferred**, so a switch-away-and-back within a tick reuses the warm root
  (no re-subscribe churn) — this is what makes the synchronous switch cheap;
- `detachedOwner` is passed **explicitly = `clientOwner`**, so the shared root lives for the
  client's lifetime (or until the last listener leaves), never tied to the first consumer.

**Lifetime contract (closes the debate's P1 hole).**
1. *Evict on last-listener disposal* — the slot factory registers `onCleanup(() => slots.delete(cacheKey))`, so when `createSingletonRoot` disposes the root (last listener gone, microtask) the Map entry is evicted; a later subscribe rebuilds a fresh slot.
2. *Evict on typed completion* — `createSubscription` gains an `onComplete` callback (fired when the `for await` ends **normally**, i.e. the server/map sent a typed end — never on abort). The slot wires `onComplete → slots.delete(cacheKey)`, so a re-added member never reuses an ended slot.
3. *Absent-at-subscribe is never cached* — enforced one layer up in `surface-map`: a subscribe against a key absent from `entries` returns an immediate per-consumer typed-end (`{reason:"absent"}`), never touching the cache. → "a live cached sub for an absent member is unrepresentable."

**Two subtleties (the reason this is a consult, not a mechanical change):**
- *Enrollment must move into the slot.* Health enrollment (`registry.enroll`) is id-keyed, so N consumers of one shared slot would each enroll a duplicate under the same name and the `health()` fold would double-count. Enroll **once inside the shared slot** (un-enrolls on root disposal); do not enroll per consumer.
- *`onError` stays per-consumer.* The shared slot owns the stream + `value/error/pending` signals but NOT the toast. Each consumer wires its own `onError` effect on the shared `sub.error()` under its own owner (factored as `wireSubscriptionError(sub, handler)`), so a per-call label still reaches its own toast and the shared error is read, not re-fetched.

**Scope.** Static-input subs only (cells, collection-per-key, keys, deltas — all via
`createSubscription`). Accessor-input subs (streams, events via `createReactiveSubscription`) stay
per-consumer, untouched — two input accessors are honestly two subscriptions. This deletes the
module-const "sharing by convention" idiom (`createSharedRoot`-as-sharing in `wire.ts`,
`useDaemonStatus.ts`, etc.) — every consumer inherits dedup from the base client.

**New dep:** `@solid-primitives/rootless@^1.5.3` added to `@kolu/surface` (today it has only
`@solid-primitives/scheduled`). FOD hash refresh rides the same commit.

---

## Layer 1 — `packages/surface-map` (new; depends only on `@kolu/surface`)

Four entrypoints: `.` (define) · `/server` · `/client` · `/solid`.

### Contract half — `defineSurfaceMap`

```ts
// A SurfaceMap is an entry spec + a BRANDED key. The brand IS zod's .brand() on the keySchema —
// the source of truth, not a hand-rolled nominal type. Only keySchema.parse produces a branded
// key, so a raw/forged key is a type error for every consumer of the typed API (P4 at the API).
function defineSurfaceMap<KS extends z.ZodType, const ES extends SurfaceSpec>(
  keySchema: KS,              // e.g. z.string().brand("HostKey")
  entry: Surface<ES>,         // e.g. padiSurface — the per-key entry surface
): SurfaceMap<KS, ES>;

type Key<M> = M extends SurfaceMap<infer KS, any> ? z.infer<KS> : never;   // the branded key type

interface SurfaceMap<KS extends z.ZodType, ES extends SurfaceSpec> {
  readonly keySchema: KS;
  readonly entry: Surface<ES>;
  /** The membership authority as a contract member: entries: Collection<Key, EntryStatus>.
   *  ONE writer publishes membership + status together (P3). Absence = not in the collection —
   *  there is NO `absent` status variant. */
  readonly contract: SurfaceMapContract<KS, ES>;   // { entries } + the key-folded entry router
}

type EntryStatus =
  | { kind: "warming" }
  | { kind: "connected"; clockOffset: number }          // offset derived by the SERVING process's
  | { kind: "failed"; reason: string };                 //   own clock at hello (P3, one named writer)
```

**Entry-router transform.** For each proc/cell/collection/stream in `entry`, the map folds the key
into the *input schema*: `input S` → `z.object({ key: keySchema }).and(S)` before `oc.input(...)`.
The handler resolves membership by `key` at call time; an unknown key is a **typed rejection** (P5
runtime gate on the wire). So a subscription carries its key in every frame *by construction* — a
call cannot cross keys any more than it can cross procs.

### Server half — `serveSurfaceMap`

**[DECISION C — consult]** The resolver/membership seam. Proposed:

```ts
function serveSurfaceMap<KS, ES>(
  map: SurfaceMap<KS, ES>,
  registry: MapRegistry<Key<typeof map>, ES>,
): { router: unknown; ctx: SurfaceMapCtx };

interface MapRegistry<K, ES> {
  /** Membership — the current member set + a subscribe for add/remove. ONE writer (the pool). */
  members(): K[];
  subscribe(onChange: () => void): () => void;
  has(key: K): boolean;
  /** Resolve a member key to something serveable, or a terminal fault. */
  resolve(key: K): EntrySession<ES> | EntryFault;
}

type EntrySession<ES> = { session: Session; surface: Surface<ES> };  // status DERIVED from session state
type EntryFault = { failed: string };                                // terminal, no session (mock/structural)
```

- The `entries` collection is published by the map from `members()` + each member's status: a
  session's connection state projects `copying|connecting → warming`, `connected → connected(clockOffset)`,
  `disconnected|failed → failed(reason)`. An `EntryFault` publishes `failed(reason)` directly.
- **Removal ends that key's live subs with a typed end BEFORE the session is destroyed** (the pin:
  no socket-error frame after a typed end) — the map completes the matching iterators, then the
  registry tears the session down; the client's abort-suppression means no spurious error.
- The pool adapter (`@kolu/surface-remote`, Phase 2) maps `buildRemotePool`'s
  `hosts()/getSession()` onto `MapRegistry`; the mock e2e harness backs the SAME seam with
  subprocess sessions — source-agnostic.

*Alternative (the note's literal spelling):* `serveSurfaceMap(map, { resolve: (k) => pool.getSession(k) })`
— session-or-undefined, membership implied by enumerating the pool. Simpler surface, but folds
membership + resolution into one call and has no home for `EntryFault`/the mock harness. **I lean to
the explicit `MapRegistry` (membership is a first-class, subscribable fact — it drives `entries`);
consulting because it diverges from the note's example line.**

### Client half — `connectSurfaceMap` + `SurfaceMapClient`

```ts
function connectSurfaceMap<KS, ES>(map: SurfaceMap<KS, ES>, link: Link): SurfaceMapClient<KS, ES>;

interface SurfaceMapClient<KS, ES> {
  /** The ONE membership authority, consumed as a normal bound collection. */
  readonly entries: BoundCollection<Key, EntryStatus>;
  /** Sole producer of a branded key from a raw string (validates + brands via keySchema). */
  parseKey(raw: string): Key;
  /** PURE lens — partial application of the key. No owner, no I/O, safe anywhere. Total. */
  entry(key: Key): Entry<ES>;
  /** Solid-only reactive lens — owns swap disposal (createKeyedRoot/mapArray internal); a key
   *  change disposes the old entry scope and rebuilds synchronously. THROWS outside an owner. */
  useEntry(key: Accessor<Key>): Entry<ES>;
  dispose(): void;
}

interface Entry<ES> {
  readonly cells: BoundCellsFor<ES>;         // remoteSurfaces.get("zest").padi.cells.daemonStatus.use(…)
  readonly collections: BoundCollectionsFor<ES>;
  readonly streams: BoundStreamsFor<ES>;
  readonly events: BoundEventsFor<ES>;
  /** Total existence-as-a-value: the EntryStatus when a member, an explicit not-a-member value
   *  when not — a client fold over `entries`, never a nullable, never a second authority. */
  state(): EntryStatus | { kind: "not-a-member" };
}
```

- `.get(key)` in the note == `entry(key)` here (pure) / `useEntry(accessor)` (reactive). The
  entry-typed subtree is the runtime-keyed analogue of the existing compile-time `surfaceClients`
  (`surfaceClient.ts:866`): scope the link to the key's slice (`scopeSibling`-style), cast to the
  entry surface's `SurfaceClient`. Nesting is internal to the atom — no signal-of-signals at call
  sites (kills C2).
- **Data-sub typed-end rule (one semantics, two timings):** removed mid-stream → `{reason:"removed"}`;
  never a member → immediate `{reason:"absent"}`, same channel. One-shot *calls* on an absent key
  typed-reject.
- Activeness is **not** here — "which key(s) this tab views" is a plain app signal; switching is a
  synchronous signal write. Pick-epoch and retirement-stubbing have no reason to exist.

### Package example (no demo app)

README hello-world (from the note) + a **mock-entry e2e harness**: subprocess "entries" served
through the SAME `MapRegistry` seam, exercising switch / add / remove / typed-end / dedup-observable.

---

## The three flagged decisions — recommendations

| # | Decision | Recommendation | Risk |
| - | -------- | -------------- | ---- |
| **A** | Branded key typing | Use **zod `.brand()`** on `keySchema`; `defineSurfaceMap(keySchema, entry)` takes the branded schema; `parseKey` (= `keySchema.parse`) is the sole producer; `entries.keys()` yields `Key[]`. P4 at the typed API (raw string ⇒ type error), P5 gate on the wire (`keySchema.parse` rejects unknown/malformed). | Low — reuses zod source-of-truth; no hand-rolled brand. |
| **B** | Dedup lifetime | `createKeyedSubscriptionCache(clientOwner)` in `buildSurfaceClient`; slot = `createSingletonRoot(make, clientOwner)`; evict on **last-listener disposal** (onCleanup) **and typed completion** (new `onComplete`); **enroll once per slot**; **onError per consumer**. Static-input only. | Medium — the enroll-once + onError-per-consumer split + microtask-deferred teardown are the load-bearing subtleties. |
| **C** | Resolver/membership seam | Explicit **`MapRegistry`** (`members()/subscribe/has/resolve`) over the note's fused `resolve: getSession`. Membership is a first-class subscribable fact driving `entries`; `EntrySession | EntryFault` keeps it source-agnostic (pool + mock harness). | Medium — diverges from the note's example line; want a ruling before building the server half on it. |
