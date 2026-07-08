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
import type { KeyCodec } from "@kolu/surface-map";

// 1 · CONTRACT — a key schema (a plain string here; needn't be `.brand()`ed — kolu's own
//     `HostKey` is a discriminated-sum object) + the REQUIRED string codec (the identity
//     pair for an already-string key), then define the map over an existing entry
//     surface. The map derives a WIRE contract that folds the key into every entry-member
//     call, and brings the `entries` membership collection for free.
const HostKeySchema = z.string();
const identityCodec: KeyCodec<string> = { encode: (k) => k, decode: (s) => s };
const hosts = defineSurfaceMap(HostKeySchema, padiSurface, identityCodec); // padiSurface: Surface<…>

// 2 · SERVER — back the map with a MapRegistry: the ONE writer of membership. Any
//     session source implements it (a warm ssh pool, a mock-subprocess harness).
//     Status is DERIVED from each resolved session's connection state.
const { router, dispose } = serveSurfaceMap(hosts, registry);
// `router` is a `{ surface: … }` fragment — hand it to directLink, or spread it into
// a host router for a wire serve path.

// 3 · CLIENT — construct the typed map client from the contract + a BRANDED transport
//     handle (e.g. `conn.transport` from `connectSurfaces`) — never a bare/pre-sliced
//     wire link, which THROWS (see `connectSurfaceMap` below).
const app = connectSurfaceMap(hosts, conn.transport);

//     The switcher chips — every host's status, LIVE, one loop:
<For each={app.entries.use().keys()}>{(host) => (
  <HostChip
    status={app.entry(host).state()}                       // EntryStatus | not-a-member — a VALUE
    awaiting={app.entry(host).cells.urgency.use().value()?.awaiting}
  />
)}</For>

//     The canvas follows the picked host — switching is a synchronous signal write:
const [activeHost, setActiveHost] = createSignal("localhost");
const active = app.useEntry(activeHost);                    // Solid: owns swap disposal
active.collections.terminals.use();                         // re-keys on switch; a removed
                                                            // host's subs end typed, and
                                                            // active.state() reads not-a-member
```

## API

### `defineSurfaceMap(keySchema, entry, codec: KeyCodec<Key>) → SurfaceMap<KS, ES>`

`keySchema` need **not** be zod-`.brand()`ed — its `z.infer` is `Key`, and `Key` can be
ANY `keySchema`-validated value, not just a string (kolu's own `HostKey` is a
discriminated-sum object). `entry` is the per-key `Surface<ES>`, kept verbatim as the
type the client subtree is generated from. The third argument — `codec: KeyCodec<Key>`
— is **required**: `{ encode(key): string; decode(wire): key }` bridges `Key` to the
canonical WIRE string every channel name / dedup key / membership entry is keyed on
(`@kolu/surface`'s own per-key channel machinery is always string-keyed). For a `Key`
that is already a plain string, `codec` is the identity pair (`{ encode: (k) => k,
decode: (s) => s }`); kolu's `HostKey` passes its own `encodeHostKey`/`decodeHostKey`.

`SurfaceMap` carries `{ keySchema, entry, contract, entriesSpec, codec }` — `contract`
folds the key into every entry-member input; `entriesSpec` is the membership
collection's WIRE spec, `Collection<string, EntryStatus>` (always string-keyed — see
`codec` above), decoded to `Key` at the client's `entries` field.

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

### `connectSurfaceMap(map, transport, siblingKey?) → SurfaceMapClient<KS, ES>`

`transport` is the **branded** parent handle (a `LiveSignalHandle`, e.g. `conn.transport`
from `connectSurfaces`). `resolveTransport(transport)` applies the half-open guard ONCE —
the sole liveness gate — and when `siblingKey` is given the map slices
`scopeSibling(fullLink, siblingKey)` **after** the guard, so the scoped slice inherits the
parent's watchdog `live` by construction. There is **no unbranded `{live}` override**: a
bare `{ live: () => true }` floored over a dead transport is unspellable (the old seam,
revised — it reopened the green-dot-over-dead-transport lie).

```ts
interface SurfaceMapClient<KS, ES> {
  readonly entries: ReadOnlyBoundCollection<Key, EntryStatus>; // the ONE membership authority — upsert/delete absent
  readonly live: Accessor<boolean>;                      // resolved transport liveness (for the membership strip)
  entry(key: Key): Entry<ES>;                            // PURE lens — no owner, no I/O, total
  useEntry(key: Accessor<Key>): Entry<ES>;               // Solid — owns swap disposal; THROWS ownerless
  dispose(): void;
}
interface Entry<ES> extends Pick<SurfaceClient<ES>, "cells" | "collections" | "streams" | "events"> {
  readonly rpc: SurfaceClient<ES>["rpc"];                // procedure client — folds {mapKey} per call
  readonly clock: { toLocal(remoteMs: number): number | null }; // reproject a host-stamped epoch; null when no offset
  state(): EntryStatus | { kind: "not-a-member" };       // total fold over entries — never nullable
}
```

`entry(key)` is *partial application of the key*: a per-key `SurfaceClient<ES>` over a
link that injects the key, cached by key. Two views of one entry's cell share one
upstream subscription (the base client's ref-counted dedup, keyed per entry). `useEntry`
re-keys on a key CHANGE — the old key's subscriptions dispose, the new key's populate
synchronously; "which host this tab views" is a plain app signal, so switching cannot
race. A `Key` has no reference identity of its own (two independent decodes of the same
wire string are logically equal but never `===`), so `useEntry` canonicalizes its
accessor's key by its ENCODED string internally — a same-key new-reference write (e.g. a
no-op click that re-decodes the active host) reads as a no-op, never a re-key. Existence
is always a **value** (`state()`), never a nullable `entry()`.

`entry(key).rpc` is the entry surface's **procedure client** for imperative point-calls
(`entry(k).rpc.surface.<ns>.<verb>(input)`) — the same key-injecting link folds `{mapKey}`
into every call, so the caller never passes the key. It is typed `SurfaceClient<ES>["rpc"]`
(`unknown` at the generic map — a consumer that knows its entry contract casts it once,
e.g. a `padiRpcOf` helper), which sidesteps the TS2590 "union too complex" a
`ContractRouterClient<Surface<ES>["contract"]>` expansion trips under a generic `ES`. An
absent-key procedure call is a **typed rejection** (`MAP_KEY_UNKNOWN`), the one-shot twin
of a sub's typed stream-end.

`entry(key).clock.toLocal(remoteMs)` reprojects a timestamp stamped on the ENTRY's host (a
remote clock) into the consuming process's local clock, via the entry's measured
`clockOffset` (`toLocal = remoteMs − offset`) — so a duration or instant rendered against
`Date.now()` stays honest across a clock-skewed host. It returns **`null`** (never a silent
identity) when the entry has no measured offset yet (warming/failed), and the `number |
null` type forces the caller to handle it (`now − null` is a type error). One mechanism at
the map boundary; a consumer routes its KNOWN host-stamped reads through it (wire-level
timestamp *branding* — every unconverted remote-epoch read a repo-wide type error — is a
larger entry-contract change left to the consumer's own domain).

## Status

Shipped and gauntleted. **kolu** serves its padi terminal surface as a host map over a warm
ssh pool: `serveHostMap` folds `buildRemotePool`'s membership + per-session state into the
`MapRegistry`, projecting each host's `EntryStatus` (warming → connected + clock-offset →
failed). The **kolu client** rides `connectSurfaceMap` wholesale — always a map, so an unset
host env is simply `N=1` with the local host as the sole member — and renders the gated,
command-palette-only selector strip + per-host urgency chips from the entry lens. Proven
end-to-end by a mock-entry harness (two entries, switch, dedup, typed-end on removal,
membership + status projection, an rpc that folds `{mapKey}` to the keyed entry + rejects an
absent key typed) and by kolu's own adoption. The wire is complete for a consumer:

- **Uniform fold envelope.** Every proc folds as `{ mapKey, input }` — one wire shape
  for any input (object, primitive, or none), and an entry input that itself carries a
  `mapKey` field cannot collide with the folded key (it rides `input`, nested).
- **Transport liveness.** The BRANDED parent handle is resolved once (`resolveTransport`,
  half-open guard applied) and its `live` threads into the `entries` client and every per-key client, so
  a chip floors its status on real transport liveness (`client.live`); constant-`true`
  only for an in-process `directLink`.

Next consumer: **drishti** adopts the same `serveHostMap` / `connectSurfaceMap` path (its PR
follows), retiring its hand-rolled keyed registry.
