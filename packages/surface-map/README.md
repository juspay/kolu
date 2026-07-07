# @kolu/surface-map

A **dynamic keyed map of remote surfaces** — one entry surface, typed once, keyed
at runtime, served as one. N entries are active by construction: a client reaches
any entry's cells/collections/streams **through the client object itself**
(`app.hosts.entry("zest").cells.daemonStatus.use(…)`), and membership is a single
authoritative collection the UI renders honestly.

It is the framework notion behind kolu's host switch and drishti's fleet view —
the unification of two hand-rolled implementations of the same pattern. Depends
only on `@kolu/surface`.

## The three halves

```ts
import { defineSurfaceMap } from "@kolu/surface-map";          // contract
import { serveSurfaceMap } from "@kolu/surface-map/server";    // server
import { connectSurfaceMap } from "@kolu/surface-map/client";  // client (+ Solid useEntry)
```

## Hello world

```ts
import { z } from "zod";
import { defineSurface } from "@kolu/surface/define";

// 1 · CONTRACT — brand the key (zod .brand is the source of truth), then define the
//     map over an existing entry surface. The map derives a WIRE contract that folds
//     the branded key into every entry-member call, and brings the `entries`
//     membership collection for free.
const HostKey = z.string().brand("HostKey");
const hosts = defineSurfaceMap(HostKey, padiSurface);   // padiSurface: Surface<…>

// 2 · SERVER — back the map with a MapRegistry: the ONE writer of membership. Any
//     session source implements it (a warm ssh pool, a mock-subprocess harness).
//     Status is DERIVED from each resolved session's connection state.
const { router, dispose } = serveSurfaceMap(hosts, registry);
// `router` is a `{ surface: … }` fragment — hand it to directLink, or spread it into
// a host router for a wire serve path.

// 3 · CLIENT — construct the typed map client once from the contract + a link.
const app = connectSurfaceMap(hosts, link);

//     The switcher chips — every host's status, LIVE, one loop:
<For each={app.entries.use().keys()}>{(host) => (
  <HostChip
    status={app.entry(host).state()}                       // EntryStatus | not-a-member — a VALUE
    awaiting={app.entry(host).cells.urgency.use().value()?.awaiting}
  />
)}</For>

//     The canvas follows the picked host — switching is a synchronous signal write:
const [activeHost, setActiveHost] = createSignal(app.parseKey("localhost"));
const active = app.useEntry(activeHost);                    // Solid: owns swap disposal
active.collections.terminals.use();                         // re-keys on switch; a removed
                                                            // host's subs end typed, and
                                                            // active.state() reads not-a-member
```

## API

### `defineSurfaceMap(keySchema, entry) → SurfaceMap<KS, ES>`

`keySchema` must be zod-`.brand()`ed — its `z.infer` is the **branded `Key`**, and
`parseKey` (client) is the sole producer of one, so a raw string is a *type error*
wherever a `Key` is expected. `entry` is the per-key `Surface<ES>`, kept verbatim as
the type the client subtree is generated from. `SurfaceMap` carries `{ keySchema,
entry, contract, entriesSpec }` — `contract` folds the key into every entry-member
input; `entriesSpec` is the read-only `Collection<Key, EntryStatus>`.

```ts
type EntryStatus =
  | { kind: "warming" }
  | { kind: "connected"; clockOffset: number }   // serving process's own-clock offset at hello
  | { kind: "failed"; reason: string };
// Absence from `entries` IS "not a member" — there is no `absent` variant.
```

### `serveSurfaceMap(map, registry: MapRegistry<Key>) → { router, dispose }`

```ts
interface MapRegistry<K> {
  members(): K[];
  subscribe(onChange: () => void): () => void;   // fires only AFTER members()/has() reflect the change (ordering)
  has(key: K): boolean;                          // members() and has() answer from one consistent view (snapshot)
  resolve(key: K): EntrySession | EntryFault;
}
interface EntrySession { readonly link: unknown; readonly state: EntryConnectionState; }
interface EntryFault   { readonly failed: string; }
```

The registry is the **one writer** of membership; `entries` is that truth published.
Status is a **projection** of the resolved session's `state` (`copying`/`connecting`
→ warming, `connected` → connected, `disconnected`/`failed` → failed), never a second
writer. A call carries its key in every frame: an unknown key is a **typed rejection**
(unary) or an immediate **typed end** (stream); a key that leaves membership mid-stream
ends its subs with a typed `{reason:"removed"}` **before** the session is destroyed — so
there is no socket-error frame after a typed end.

### `connectSurfaceMap(map, link) → SurfaceMapClient<KS, ES>`

```ts
interface SurfaceMapClient<KS, ES> {
  readonly entries: BoundCollection<Key, EntryStatus>;   // the one membership authority
  parseKey(raw: string): Key;                            // sole branded-key producer
  entry(key: Key): Entry<ES>;                            // PURE lens — no owner, no I/O, total
  useEntry(key: Accessor<Key>): Entry<ES>;               // Solid — owns swap disposal; THROWS ownerless
  dispose(): void;
}
interface Entry<ES> extends Pick<SurfaceClient<ES>, "cells" | "collections" | "streams" | "events"> {
  readonly rpc: SurfaceClient<ES>["rpc"];                // procedure client — folds {mapKey} per call
  state(): EntryStatus | { kind: "not-a-member" };       // total fold over entries — never nullable
}
```

`entry(key)` is *partial application of the key*: a per-key `SurfaceClient<ES>` over a
link that injects the key, cached by key. Two views of one entry's cell share one
upstream subscription (the base client's ref-counted dedup, keyed per entry). `useEntry`
re-keys on a key change — the old key's subscriptions dispose, the new key's populate
synchronously; "which host this tab views" is a plain app signal, so switching cannot
race. Existence is always a **value** (`state()`), never a nullable `entry()`.

`entry(key).rpc` is the entry surface's **procedure client** for imperative point-calls
(`entry(k).rpc.surface.<ns>.<verb>(input)`) — the same key-injecting link folds `{mapKey}`
into every call, so the caller never passes the key. It is typed `SurfaceClient<ES>["rpc"]`
(`unknown` at the generic map — a consumer that knows its entry contract casts it once,
e.g. a `padiRpcOf` helper), which sidesteps the TS2590 "union too complex" a
`ContractRouterClient<Surface<ES>["contract"]>` expansion trips under a generic `ES`. An
absent-key procedure call is a **typed rejection** (`MAP_KEY_UNKNOWN`), the one-shot twin
of a sub's typed stream-end.

## Status

Vertical slice, proven end-to-end by a mock-entry harness (two entries, switch, dedup,
typed-end on removal, membership + status projection, and an rpc that folds `{mapKey}` to
the keyed entry + rejects an absent key typed). The wire is complete for a consumer:

- **Uniform fold envelope.** Every proc folds as `{ mapKey, input }` — one wire shape
  for any input (object, primitive, or none), and an entry input that itself carries a
  `mapKey` field cannot collide with the folded key (it rides `input`, nested).
- **Transport liveness.** The link is resolved once (`resolveTransport`, half-open guard
  applied) and its `live` threads into the `entries` client and every per-key client, so
  a chip floors its status on real transport liveness (`client.live`); constant-`true`
  only for an in-process `directLink`.

Phase 2 (kolu adoption) then serves the real padi surface over the warm ssh pool as the
`MapRegistry`, and renders the gated selector strip + urgency chips on this client.
