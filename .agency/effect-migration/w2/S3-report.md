# W2 Stage 3 — the client face + the Solid bridge

Scope delivered: `src/client.ts` (the retry fence + the nested member face),
`src/links/direct.ts` (the in-process dispatcher), `src/runStream.ts` (NEW — the one
Effect→callback run edge), `src/solid/**` (the whole bridge), `src/project.ts`,
`src/mirrorRemoteSurface.ts`, `src/pollOnChange.ts`, plus a compatible extension to
the committed `src/link.ts` seam. Wire links (`links/{websocket,stdio,unix-socket}`,
`peer-server`, `unix-socket`, `loopback`, `stdio-codec`) are Stage 4's and untouched.

---

## 1. The face, top to bottom

Three layers, each with one job. The split is what keeps D2's "type the face from
the spec" affordable: only the middle layer is spec-derived, and only per member.

```
 SurfaceDispatch          (src/link.ts)      erased, tag-keyed, transport-neutral
   ↓ buildSurfaceFace     (src/client.ts)    re-nests flat tags: face.surface[m][verb]
   ↓ buildSurfaceClient   (src/solid/…)      spec-typed .cells/.collections/… + health
```

### 1.1 `buildSurfaceFace(surface, dispatch) → SurfaceFace` (`src/client.ts`)

The addressing layer. Walks the spec once and mints one ref per member verb at
`face.surface[member][verb]`, using `surfaceTag(surface.tagPrefix, member, verb)` —
the SAME tag algebra `defineSurface` mints with, read off the surface value, so the
face never learns whether it faces a standalone surface or a composed sibling. The
three reserved `system/*` members are added at the same tags, which is what keeps
S1's `probeSurfaceLive`/`probeSurfaceIdentity`/`probeSurfaceClockNow` green: they
still walk `client.surface.system.<verb>` structurally.

- **unary verbs** return `Promise` (`Effect.runPromise` — the framework's one
  Promise edge for calls; PLAN locked decision 1 keeps Solid leaves plain async).
  `runPromise` rejects with the SQUASHED failure, i.e. the declared tagged-error
  INSTANCE with `_tag` and data intact, which is what makes `_tag` narrowing at a
  `catch`/`safe` site honest.
- **streaming verbs** return a lazy `Stream.Stream<O, unknown>` — RAW, unfenced.
  The fence is applied by the consumer (`unenrolledStreamCall` / the `.use()`
  hooks), so a `.unenrolled*` carve-out ref is honestly raw.

`SurfaceFace` is deliberately STRUCTURAL (`{ surface: Record<string,
Record<string, unknown>> }`). Per-member precision lives one layer up. A second
precise mapped type over the same spec, in the same evaluation pass, is exactly the
union-budget blowup D2 exists to avoid.

### 1.2 Which SIDE of the schema each position speaks (D2 / #13)

The rule is **not** "everything is encoded". It is:

> A position whose value the CLIENT ALSO HOLDS OR INTERPRETS is **decoded**. A
> position that is purely an ARGUMENT forwarded to the server is **encoded**, and
> the face decodes it at the edge.

| position | side | why |
|---|---|---|
| cell `get` frame | decoded | rendered |
| cell `set` / `patch` payload | **decoded** | merged into the local-authority store by the spec's own `patch(current, patch)` and seeded from the spec's own `default` — both decoded. Typing it encoded would make the client hold two representations of one value and feed the wrong one to the declared merge. |
| collection key / value (`get`,`upsert`,`delete`,`keys`,`deltas`) | **decoded** | the key is an identity in the client's own key set; the value is rendered |
| stream / event `input` | **encoded** | a pure argument |
| procedure `input` | **encoded** | a pure argument |
| every success / frame | decoded | rendered |

The face therefore decodes EXACTLY the positions it advertises as encoded, via
`Schema.decodeUnknownSync` (which throws `SchemaError` — the fail-fast `.parse`
semantic, at the same place zod's `.parse`-at-input used to run). Either way the
value handed to `SurfaceDispatch` is the DECODED one, which is what both dispatchers
want: the direct dispatcher passes it to a handler S2 typed on the decoded payload;
a wire dispatcher passes it to Effect RPC's flat client, which encodes for the wire.

`SurfaceTypes<S>`'s `ValueWire` / `PatchWire` / `KeyWire` fields are therefore NOT
consumed by the face. They remain available to consumers; S1's rationale for minting
them is unaffected, but nothing in this stage indexes them. **Flagged for Stage 5**:
either keep them as consumer affordances or drop the three the face declines to use.

### 1.3 The bound faces (`src/solid/surfaceClient.ts`)

`.cells` / `.collections` / `.streams` / `.events` / `.procedures` / `.rpc` /
`.health()` / `.enroll` / `.rawStream` / `.dispose` — the same ten members as
before. Type changes:

- `SurfaceClient<S>` **lost its second type parameter**. There is no contract type
  to thread any more (the seam is the erased `SurfaceDispatch`), so `.rpc` is the
  structural `SurfaceFace`.
- `BoundStream<I,T>` / `BoundEvent<I,T>` take `I` from
  `spec.streams[K].inputSchema["Encoded"]` (was the decoded `StreamSpec<I,_>` arg).
- `BoundProcedure<S>` is a four-arm ladder over `WireSchemaAny`:
  `(input: In["Encoded"]) => ProcedureResult<Out["Type"], ProcedureSpecError<S>["Type"]>`.
  The second `options` argument is **gone** (no `signal` under Effect, no retry
  context for a write).
- `ProcedureResult<T,E> extends Promise<T>` with a `__error?: E` phantom — the
  D4 successor of oRPC's `ClientPromiseResult`, and what `safe` reads the declared
  union off.

`memberOf(face, key)` replaces the old lazy `get`-ters that tolerated a PARTIAL mock
link: the face is no longer caller-supplied, so there is nothing partial to tolerate
— a test stubs the DISPATCH, one layer down — and a missing member is now a loud
framework-bug crash.

### 1.4 `surfaceClients` — siblings by tag, not by re-wrap

`scopeSibling(link, key)` (the `{ surface: link.surface[key] }` re-wrap) is replaced
by `scopeSiblingDispatch(dispatch, key)`, which splices the key into every tag via
S1's `scopeSiblingTag`. Each sibling's face is built from the STANDALONE surface
value, so the face never learns it is scoped — the client-side twin of the server's
per-sibling re-walk. `scopeSiblingTag` throws on a non-surface tag, so a mis-scoped
dispatch fails at the seam rather than 404-ing at the far end.

---

## 2. The retry fence (PLAN D3 / review #12 / #8) — `src/client.ts`

```ts
isTransportError(e)          // structural: e._tag === "RpcClientError"
shouldRetryStreamError(e)    // isTransportError(e) || isSurfaceRelayTransportLost(e)
STREAM_RETRY_DELAY_MS = 1000
STREAM_RETRY = Schedule.while(Schedule.spaced(1000), ({input}) => shouldRetryStreamError(input))
fenceStream(stream, { onRetry? })
unenrolledStreamCall(procedure, input, { onRetry? }) → Stream
```

- The old fence was a DENYLIST ("retry unless it's an `ORPCError`"). This one is a
  POSITIVE match, so a declared (D4) error is never mistaken for a transport drop
  merely because recognition failed.
- `RpcClientError` is matched by `_tag`, not `instanceof`: it crosses module
  instances (two copies of `effect` in a bundle; a relay hop that decodes and
  re-encodes), and an `instanceof` against one realm's class would silently stop
  recognising the other's — turning "retry forever" into "surface the drop", the
  #1564 shape. It also keeps `client.ts` free of a dependency on the rpc subpath.
- The two PERMANENTLY-dead tags fall out by construction: they are tagged surface
  errors, not `RpcClientError`s, so `shouldRetryStreamError` is `false` for them.
- `lastEventRetry` (oRPC's server-suggested SSE backoff) **has no Effect RPC
  counterpart** — the ndjson protocol carries no retry hint. The schedule is the
  constant the old code fell back to. Recorded in code, per D3.
- **#8's `onRetry`** is `Stream.tapError` INSIDE the retry, gated on the same
  predicate the schedule uses — so "fired ⇒ a re-subscribe follows" holds, and a
  consumer that clears its buffer is never left with a cleared view and no new
  stream. Per-attempt identity is structural: the tap belongs to that attempt's own
  fenced stream, and interrupting the subscription interrupts the tap with it.

**Acceptance (new): `src/solid/reconnectSnapshot.test.ts`, 5 tests.** Written against
behaviour, not mechanism, end-to-end through the real face over a scripted dispatch:

1. a mid-stream transport drop → EXACTLY one re-subscribe, exactly one fresh
   snapshot, `updated` fires exactly once, `sub.error()` stays `undefined`, the sub
   is not stuck pending, and `client.health()` reports no errored sub;
2. `SurfaceRelayTransportLost` retries the same way (the one transient framework
   error);
3. a DECLARED error does NOT retry — it reaches `error()` on its first occurrence,
   tag intact, and DOES show in `health()` (without this arm, "retry forever" would
   be indistinguishable from "swallow everything");
4. `onRetry` fires exactly once, between the failed attempt's last frame and the
   next attempt's first;
5. `onRetry` does NOT fire for a failure the fence refuses to retry.

---

## 3. The one run edge — `src/runStream.ts` (NEW)

`runStreamScoped(stream, { onFrame, onEnd, onFailure }) → stopper`.

Every non-Effect consumer in the package runs streams through this one function:
`createSubscription`, `createReactiveSubscription`, `useEvent`, `client.rawStream`,
`pollOnChange`. It owns three rules so nobody re-derives them:

- teardown is a fiber interrupt, and after the stopper runs NOTHING reports (not a
  late frame, not the interruption exit, not a failure racing the stop) — the
  "a disposed subscription cannot report anything" rule, in one place;
- an interruption is never a failure (`Cause.hasInterruptsOnly`), so an unmount
  never registers as a subscription error in `client.health()`;
- a failure is normalised to `Error` once (`Cause.squash` + `toError`), so a tagged
  surface error still arrives as itself and a caller can narrow on it.

It lives at the package ROOT, not under `solid/`, because it has nothing to do with
Solid — `pollOnChange` is deliberately Solid-free and runs its pulse through the
same edge. This is also the concrete answer to #25/D10: `Effect.runFork` in this
package's consumer tier appears **exactly here**, plus two named exceptions
(`buildSurfaceFace`'s `Effect.runPromise` for unary calls, `liveSignal`'s
`Effect.runPromise` for the heartbeat probe) and `project.ts`'s `deriveCell`
connector (which must return an AbortSignal-shaped `Disposer` — see §6).

---

## 4. `createLiveSignal` on `WatchableWire` (review #4) — `src/solid/liveSignal.ts`

```ts
createLiveSignal(transport: WireTransport, opts) → LiveSignalHandle
LiveSignalHandle = { live, status, dispatch, dispose }   // was { live, status, link, dispose }
```

- **Not generic any more.** There is no contract type to thread; per-member
  precision lives in the spec-derived bound faces (D2/#16).
- **Status** is derived from `wire.onStatus`, projected onto the unchanged
  `SurfaceConnectionStatus`. The one asymmetry the raw wire status cannot carry —
  `closed`/`connecting` BEFORE the first open is a cold start (`connecting`), after
  it is a heal (`reconnecting`) — is held by an `everOpened` latch.
- **Recovery** is `wire.forceReconnect()` (was `ws.reconnect()`).
- **Probe** is `dispatch.unary(surfaceTag(prefix, "system", "live"), {})`, sliced by
  tag for a sibling — so there is no caller-supplied probe target at all, which is a
  strictly stronger version of the old "the link is built from the socket we watch".
  Heartbeat wiring is otherwise unchanged (`heartbeat.ts` untouched; a REJECTED
  probe still counts as alive — the round-trip completed).
- **The brand survives** unchanged in kind: module-private un-reflectable `WeakSet`,
  one minter, no opt-out. It is now backed by a positive PRECONDITION:
  `createLiveSignal` THROWS unless `isHalfOpenDispatch(transport.dispatch)`, i.e.
  unless a real wire link factory minted the pairing. The old "watch ws1, build over
  ws2" forge stays unspellable through any exported API.

---

## 5. Seam changes to `src/link.ts` (compatible extensions — Stage 5 reconciles)

Two additions. Neither invalidates anything Stage 4 compiles against today.

1. **`WireStatus` gained a fourth member, `"retired"`** — terminal, meaning the
   SERVER retired this wire (`STALE_PROCESS_CLOSE_CODE` 4001, D5/#5). Additive for
   producers; the only consumer is `createLiveSignal`, which maps it to the terminal
   `down` status.
   **Why**: `createLiveSignal` used to own `retireOnStaleClose` + `restartCloseCode`
   and classify the close code itself. #5 requires the LINK to own that classifier
   anyway (it must stop the retry schedule and fail in-flight calls with
   `SurfaceTransportRetired`), so keeping a second copy of the close-code knowledge
   in the watchdog would be two authorities for one fact. The two options are
   therefore **deleted** from `CreateLiveSignalOptions`.
   **Stage 4 must**: emit `"retired"` instead of `"closed"` from the websocket
   link's terminal-close classifier. **Stage 5 must**: re-point
   `@kolu/surface-app`'s `connectSurface`, which passes `restartCloseCode` today.
2. **`WireTransport = { dispatch, wire }`** — a pure type, no runtime obligation. It
   names the pairing a wire link factory mints together, which is what
   `createLiveSignal` takes. Stage 4's link factories should return this shape.
3. **`SurfaceDispatch.stream` gained a stated INVARIANT** (doc-only): the returned
   stream must not emit or END synchronously with the subscribe. Wire dispatches
   satisfy it for free; `directDispatch` satisfies it deliberately with an
   `Effect.yieldNow`. It is written at the seam because the consequence is not
   local — a stream that reaches its typed end inside the subscribe fires the keyed
   cache's slot eviction while the slot is still being constructed, so N consumers
   of one member each open their own upstream subscription and a shared
   local-authority store splits in two.

### Two asks of Stage 4

- **Emit `"retired"`** from the websocket link's terminal-close classifier (see
  extension 1). `createLiveSignal` maps it to the terminal `down` status; nothing
  else reads it.
- **Pin the brand positively.** Nothing anywhere asserts that a real wire link
  factory APPLIES `brandHalfOpenDispatch`. `links/direct.test.ts` pins the negative
  (`isHalfOpenDispatch(directDispatch(...)) === false`), and `surfaceClient`'s
  refusal is pinned against a hand-branded fake — so the brand call could be
  deleted from the wire factory and the whole repo would stay green, silently
  re-opening the green-dot-over-a-dead-link lie (#1564). Until Stage 3, the health
  test's real-`stdioLink` case covered this incidentally; it no longer does (that
  test now uses a branded fake, because `links/stdio.ts` was being rewritten
  concurrently). One line in `links/stdio.test.ts` /
  `links/websocket`'s suite closes it: `expect(isHalfOpenDispatch(t.dispatch)).toBe(true)`.

---

## 6. `project.ts` and `mirrorRemoteSurface.ts` on the new world

**`project.ts`.** `surfaceClientRef(source, served)` takes `{ handlers }` (was a
router) and builds the face over `directDispatch`. `deriveStream`/`deriveEvent`
collapse to a `Stream.map` + `Stream.orDie` — the whole `mapUpstream` /
`iterateUntilAborted` / `isAbortReason` apparatus is GONE, because teardown is
inherited: B's consumer interrupts, the map propagates it, A's subscription closes
through its own finalizers. `deriveCell` still holds a controller-equivalent (a
`Fiber`) because `CellConnector` is still AbortSignal-shaped — S2 recorded that as a
`reactor.ts` coupling, not a choice.

`SurfaceClientOf<S>` is now a **read face** (`SurfaceReadFace<S>`): one `get` per
cell/stream/event plus the declared procedures. Narrower than the old
`ContractRouterClient<SurfaceContractFor<S>>` on purpose — a projection CONSUMES A
and never mutates it, so spelling `set`/`patch`/`upsert`/`delete` would cost union
budget for members no projection can use.

**`mirrorRemoteSurface.ts`.** Same public contract, Stream-native engine:

- `runSubscription(program, signal, log, label)` is the ONE place the three outcome
  rules live — interruption is silence; an UPSTREAM failure is a logged blip that
  settles; a SINK failure REJECTS `done`. `applySink(fold)` converts a caller's
  throw into a `SinkError` FAILURE so every sink call site routes through the one
  channel `runSubscription` recognises.
- `mirrorCollection`'s per-key pumps are **scoped CHILD FIBERS** instead of detached
  `async` functions with `AbortController`s. The `Set<Promise>` + `allSettled`-in-a-
  `finally` ownership dance (#1719, the padi reconnect flake) is deleted: a child
  fiber's lifetime IS the scope's, so a pump cannot outlive `done`.
  **Measured, not assumed**: a `forkChild`ed effect that FAILS does **not** interrupt
  its parent in effect@4.0.0-beta.102 (probed both standalone and in the exact
  `Effect.scoped(Stream.runForEach(…))` shape used here). So a per-key SINK failure
  is latched into a `Deferred` and the keys loop is `Effect.raceFirst`-ed against
  awaiting it — the Effect successor of the old `rejectSink` + `Promise.race`
  channel, and there for the same reason. Without it `done` would RESOLVE on a
  broken local fold, silently weakening the sink contract on the per-key path only.
- Every client verb is now called on the SUBSCRIPTION fiber (`Stream.suspend`, and
  `keys`/`deltas` are passed as thunks), because a member ref returns a `Stream` and
  can throw SYNCHRONOUSLY where the old `async` verb could only reject. Otherwise a
  wrong-surface stub would throw straight out of `mirrorRemoteSurface(...)`, past
  the file's own "every streaming failure arrives on `done`" contract — which a
  caller firing `done` `void`-style (the daemon does) has no way to catch. Pinned by
  a new test.
- `guardUpstream` and the `isAbortReason` swallow are gone with the AbortSignal that
  raised them.
- `ProcedureForwarder` loses its per-call `{ signal }` (no cancellation token under
  Effect) and moves its input to the Encoded side; the top-level
  `MirrorRemoteSurfaceOptions.signal` REMAINS (it is the non-Effect consumers'
  cancellation vocabulary, translated into one interrupt at this edge).
- `SurfaceSink`'s stream/event `input` is now `InputWire` (encoded), matching the
  face.

**`src/pollOnChange.ts`** (not in the stage's file list, but red the moment
`client.ts` moved — it is client-tier, not Stage 4's) now runs its pulse through
`runStreamScoped`. Its `query` arm keeps its `AbortSignal`: the query is a
caller-supplied Promise, not a surface member.

---

## 6a. Three behaviour changes the port forced, stated rather than absorbed

1. **`error()` is TERMINAL for a subscription now, and the docs say so.** The old
   `if (error()) setError(undefined)` clear-on-next-frame branch is DEAD under the
   new edge: `runStreamScoped` reports a failure from the fiber's EXIT, so no frame
   can follow one on the same subscription. The branch is deleted rather than kept
   as a false promise of recovery. The property `client.health()` actually needs is
   unchanged and still holds one layer up — the retry fence means a TRANSPORT drop
   never reaches `error()` at all; what reaches it is a declared (D4) failure, for
   which terminal is the honest reading. The remaining clearing points are named in
   code: `createReactiveSubscription`'s input-change reset, `rawStream`'s
   `onRetry`, and a keyed-cache slot rebuild. Three docstrings that leaned on
   "self-clearing" were corrected, not left to rot.
2. **The heartbeat probe no longer strands a fiber.** `HeartbeatOptions.probe` is a
   Promise seam with no cancel hook, so when the watchdog times a probe out — or
   abandons one on a suspension-void / `wake()` — it stops WAITING but nothing
   stopped the work. Over a half-open wire that is the case that recurs every
   interval, so each stale verdict would strand a fiber and an unanswered request
   entry for the life of the page. `createLiveSignal` now `runFork`s the probe,
   keeps the fiber, and interrupts it at the two points a probe is abandoned (the
   next probe starting; `dispose()`). The heartbeat's own generation guard already
   drops the stale settle, so an interruption cannot answer for its successor.
3. **`mirrorCollection`'s per-key sink failures** — see §6; the `forkChild`
   propagation assumption was measured false and replaced with an explicit latch.

Findings 1 and 2 were surfaced by the test-port pass and fixed here, not deferred.

---

## 7. Helper renames / redesign (D4) — `isDefinedError` / `safe`

Both names KEPT, both re-owned by `src/solid/surfaceClient.ts` (they were re-exports
from `@orpc/client`). The old semantics do not survive the discriminant change, so:

```ts
isDefinedError(error): error is { _tag: string }
// "did the server DECLARE this?" — a tagged, schema-carried failure, and NOT an
// RpcClientError. Structural, because a declared error crosses a relay hop by being
// decoded and re-encoded and may arrive from another module instance.

type SafeResult<T, E> =
  | { ok: true;  data: T;         error: undefined }
  | { ok: false; data: undefined; declared: true;  error: E }
  | { ok: false; data: undefined; declared: false; error: unknown }

safe(call: ProcedureResult<T,E>): Promise<SafeResult<T,E>>
```

`declared` is the discriminant, so on its `true` arm `error` is the procedure's own
declared union — narrow enough to `switch (r.error._tag)` — and on its `false` arm it
is honestly `unknown`. The old `{ error, data }` destructure and the old
`isDefinedError(error) && error.code === "…"` compare BOTH break; the one consumer in
this repo (`packages/client/src/kaval/useDaemonRestart.ts`) is W5's.

---

## 8. Public API breaks (additions to the drishti/odu follow-up list)

Beyond S1's and S2's lists:

1. `directLink(router)` → **`directDispatch(served)`** returning a `SurfaceDispatch`.
   `isDirectLink` → **`isDirectDispatch`** (moved to `@kolu/surface/link`).
2. `surfaceClient(surface, transport)` / `surfaceClients(transport, entries)` take a
   `LiveSignalHandle` **or a `SurfaceDispatch`** — not a link object.
   `buildSurfaceClient(surface, **dispatch**, live, onClientError?)`.
   `resolveTransport(t)` returns **`{ dispatch, live }`** (was `{ link, live }`).
3. `SurfaceClient<S, Rpc>` → **`SurfaceClient<S>`**; `.rpc` is a structural
   `SurfaceFace`, not a typed contract client.
4. `LiveSignalHandle<C>` → **`LiveSignalHandle`** (non-generic); `.link` →
   **`.dispatch`**. `createLiveSignal(ws, opts)` → **`createLiveSignal({dispatch,
   wire}, opts)`**. `WatchableSocket` is **deleted** (the seam is `WatchableWire`).
   `CreateLiveSignalOptions` loses **`retireOnStaleClose`** and
   **`restartCloseCode`**.
5. `StreamingProcedure<I,O>` is now **`(input: I) => Stream<O, unknown>`** (was
   `(input, {signal, context}) => Promise<AsyncIterable<O>>`). `unenrolledStreamCall`
   returns a **`Stream`** and takes only `{ onRetry? }`.
6. `createSubscription(**stream**, options?)` and
   `createReactiveSubscription(inputFn, **(input) => Stream**, options?)`.
   `useCollectionDeltas`'s `source` is a **`Stream`**, not a factory.
7. `BoundProcedure` loses its second `options` argument; `BoundProcedureOptions` is
   **deleted**. Bound procedure results are `ProcedureResult<T,E>`.
8. `isDefinedError` / `safe` — same names, new shapes (§7). New export
   **`SafeResult`**, **`ProcedureResult`**.
9. **Deleted**: `SURFACE_RELAY_TRANSPORT_LOST` / `SURFACE_TRANSPORT_RETIRED` /
   `SURFACE_STDIO_TRANSPORT_CLOSED` code constants, `deadTransportError`,
   `shouldNotRetryORPCError`, and `client.ts`'s copies of the three `is*` predicates
   (they live in `./errors` under the same names, per S1). `STREAM_RETRY` is now a
   `Schedule`, not a plugin-context object.
   **New**: `isTransportError`, `shouldRetryStreamError`, `STREAM_RETRY_DELAY_MS`,
   `fenceStream`, `StreamFenceOptions`, `UnaryProcedure`, `SurfaceFace`,
   `buildSurfaceFace`, `runStreamScoped`, `StreamRunHandlers`, `toError`,
   `WireTransport`.
10. `project.ts`: `SurfaceClientOf<S>` is a read face; `surfaceClientRef(source,
    **served**)`; `UpstreamSource<I,F>` is `(input) => Stream<F>`;
    `deriveCell(upstream, map, initial, opts?)` takes a `(undefined) => Stream<F>`.
    `SurfaceContractFor` is gone with S1.
11. `mirrorRemoteSurface`: `ProcedureForwarder` drops `{ signal }`; `SurfaceSink`
    stream/event `input` is the encoded side; `EntryClient` verbs are
    `StreamingProcedure`s.
12. `solid` barrel: `AnyContractRouter` re-export **deleted** (nothing to constrain
    over any more); `WatchableSocket` and `BoundProcedureOptions` deleted;
    `runStreamScoped`/`StreamRunHandlers`/`toError`, `UnaryProcedure`,
    `SurfaceFace`, `ProcedureResult`, `SafeResult` added.
13. `package.json` gained the subpath **`"./link": "./src/link.ts"`** — the seam
    both a wire link factory (Stage 4) and a consumer wiring `createLiveSignal`
    must import (`SurfaceDispatch`, `WatchableWire`, `WireTransport`, the brands).

---

## 9. Deviations from the brief, with reasons

1. **Cell/collection mutation inputs stay on the DECODED side** (§1.2). The brief
   says "inputs on the ENCODED side"; taken literally that breaks the
   local-authority path, whose store and whose spec-declared `patch(current, patch)`
   merge are decoded, and whose seed is the decoded `CellSpec.default`. The line
   drawn instead is stated as a rule, applies uniformly, and leaves the #13
   divergence exactly where it bites (procedure / stream / event inputs — which is
   what `boundProcedure.test-d.ts` pins).
2. **`src/runStream.ts` is a NEW root file**, outside the stage's listed ownership.
   It collides with nothing Stage 4 owns, and the alternative — four copies of the
   `runFork`/observer/interrupt dance, or importing a `solid/` file from the
   deliberately Solid-free `pollOnChange` — is worse on both counts.
   `src/pollOnChange.ts` was likewise touched: it consumes `client.ts` and went red
   the moment the fence landed.
3. **`boundProcedure.test-d.ts` is pinned against `SurfaceRpcsFor<S>`, not against a
   generated client.** The old file's "other derivation" was
   `ProcedureContract` → oRPC's `ContractRouterClient`; both are deleted. S1's Rpc
   oracle is the honest successor, and the assertions are the same three shared
   facts (input-presence, success, declared errors) per arm. The #13 section gained
   a NEGATIVE half it could not have before: `{pid: 1}` is assignable to the bound
   input and NOT to `Rpc.PayloadConstructor` (the make-in side the generated client
   would demand) — so the file now records what a drift would drift TO.
4. **`.rpc` is not spec-typed.** Every consumer that reached a member through `.rpc`
   for typing now has a typed bound face for it; `.rpc` is the reserved-member walk
   plus an escape hatch. Recorded as break #3.
5. **`isHalfOpenDispatch` / `isDirectDispatch` still return `boolean`, not type
   predicates.** Deliberate: WeakSet membership proves PROVENANCE, not shape, so a
   `value is SurfaceDispatch` predicate would assert something the brand does not
   establish. `createLiveSignal`'s guard is therefore a runtime check that narrows
   nothing — which is the honest reading of what it checks.
6. **The `deriveStream`/`deriveEvent` upstream failure becomes a DEFECT**
   (`Stream.orDie`). A served handler's stream is typed `Stream<T>` (no declared
   failures), so an upstream failure is by definition undeclared — D4's "undeclared
   throw is a defect". The old code let it propagate as an iterator rejection.

---

## 10. Gate

```
vitest run  src/links/direct.test.ts src/project.test.ts
            src/mirrorRemoteSurface.test.ts src/mirrorPumpOwnership.test.ts
            src/solid/ src/firstFrame.test.ts src/wait.test.ts
  → 22 files, 211 tests, ALL GREEN

tsc --noEmit (whole package) → ZERO errors, in every file, owned or not
biome lint --error-on-warnings (every owned file) → clean
biome format (every owned file + package.json) → clean
grep for `@orpc` / `from "zod"` across src/ → NO hits anywhere in the package
```

Test-count deltas worth naming (nothing was deleted; several files gained pins):

| file | note |
|---|---|
| `solid/reconnectSnapshot.test.ts` | **NEW**, 5 tests — the #12 + #8 acceptance |
| `solid/createSubscription.test.ts` | +2 `it`s: typed-end `complete` latching + `onComplete`-once, and "an interrupted subscription never latches `complete`". The brief names typed-end latching as a preserved law and NO test in these files pinned it directly. |
| `solid/createLiveSignal.test.ts` | +2 `it`s: the `isHalfOpenDispatch` fail-fast (the teeth of the unforgeable brand, previously untested), and "a RETIRED wire is terminal" — the fact `retireOnStaleClose` existed for, which must not vanish with the option. |
| `links/direct.test.ts` | +2: the brand pair, and the unbound-tag fail-fast on both legs |
| `mirrorRemoteSurface.test.ts` | +1: a synchronously-throwing client verb surfaces on `done` |
| `project.test.ts` | `deriveCell.dispose()` STRENGTHENED — the old assertion (`expect(a.surface).toBeDefined()`) was vacuous; it now observes the teardown its title claims |

### Stage-4-owned test files excluded from this stage's run

`src/links/stdio.test.ts`, `src/links/stdio-codec.test.ts`, `src/peer-server*.test.ts`,
`src/unix-socket.test.ts`, `src/procedureErrors.test.ts` — transports, being ported
concurrently by Stage 4 in the same worktree.

---

## 10.2 Docs obligation, deliberately deferred

`.claude/rules/surface-reference.md` requires `website/src/content/surface/ref-surface.mdx`
to move with any public-API change. §8 is a long list of them — but Stage 4 is
rewriting the other half of the same API in the same worktree right now, so a
Reference rewrite landed here would be stale before it was read. PLAN W6 already owns
"examples + website surface reference MDX"; §8 is written as the changelog that pass
consumes. **The rule is satisfied by the PR, not by this commit** — flag it if W6
slips.

---

## 11. Nothing here invalidates a PLAN assumption

- **D2** holds, with §1.2 as the promised precision on "which side": the face is
  typed from the spec, the erased seam carries no type information, and the
  TS2590 budget is spent once (per member) rather than on a second nested client.
- **D3/#12** is realised and pinned by an acceptance test that would fail under the
  `retryTransientErrors`-only design the finding disproved.
- **#8** survives with per-attempt identity, and gained a negative pin.
- **#4** is closed: the watchdog's three affordances come from `WatchableWire`, and
  the brand is now backed by a precondition rather than by construction-order alone.
- **#13** is accommodated where it bites and deliberately not where it would break
  the local-authority store; the type-level gate is ported, not deleted.
- **D10/#25** got its concrete shape: one run edge, three named exceptions, all in
  files a W6 allowlist test can enumerate by name.
- No `package.json` `dependencies` block changed, so PLAN standing rule 5 does not
  fire for this stage.
