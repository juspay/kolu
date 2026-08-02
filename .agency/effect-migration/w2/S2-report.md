# W2 Stage 2 — the server runtime (`@kolu/surface/server` on Effect handlers + `Stream`)

Scope delivered: `src/server.ts` (rewritten on Stage 1's kernel), a new test-only
`src/handlerDispatch.testlib.ts`, the new `src/streamOrdering.test.ts` (the #7
spec), and the ported server-owned suites. Transports (`links/*`, `peer-server`,
`unix-socket`, `loopback`), the Solid client (`solid/*`, `client.ts`) and
`project.ts` are untouched — Stages 3/4.

---

## 1. The shape Stages 3 and 4 bind against

### 1.1 `SurfaceRuntime`

```ts
interface SurfaceRuntimeHandle<Ctx> {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;   // the flat group defineSurface minted
  readonly handlers: SurfaceHandlers;            // NEW — replaces `router`
  readonly ctx: Ctx;                             // unchanged
  readonly done: Promise<void>;                  // unchanged semantics
  close(): Promise<void>;                        // unchanged semantics
}
```

`router` is **gone**. `done`/`close` are byte-for-byte the old contract
(`superviseSurface` / `superviseTerminalSource` are carried over verbatim): `done`
rejects on an owned fault (a cell connector rejecting), resolves on a clean
`close`; `close` is idempotent, aborts every source first, then settles+disposes
each independently; teardown faults route to `done`, never out of `close`. Fault
disposition is still the caller's to decide.

### 1.2 `SurfaceHandlers` — the record

```ts
type SurfaceHandlerResult = Effect.Effect<any, any> | Stream.Stream<any, any>;
type SurfaceHandler = (payload: any) => SurfaceHandlerResult;
type SurfaceHandlers = Record<string, SurfaceHandler>;   // NULL-PROTOTYPE object
```

- keyed by the **FULL wire tag**: `surfaceTag(surface.tagPrefix, member, verb)` —
  `surface/<member>/<verb>` standalone, `surface/<key>/<member>/<verb>` for a
  composed sibling. The walk reads `tagPrefix` **off the surface value**, so it
  never learns whether it is looking at a standalone surface or a sibling;
- the payload is the **DECODED** side (handlers work in domain values, as before);
- unary → `Effect`, streaming → `Stream`. There is no third shape: no bare value,
  no Promise. That is what makes the record simultaneously
  `RpcGroup.toLayer(handlers)` for **Stage 4** and `handlers[tag](payload)` for
  **Stage 3**'s zero-serialization in-process dispatcher — the *same handler
  value*, not two code paths;
- **null prototype** (`Object.create(null)`): member names are arbitrary strings,
  so a member named `toString` must not collide with an inherited property (which
  would make the duplicate-tag guard fire falsely and make a lookup return a
  function nobody bound).

**Stage 4**: `runtime.group.toLayer(runtime.handlers)`.
**Stage 3**: `runtime.handlers[scopeSiblingTag(tag, key)]?.(payload)`, with the
`live`-constant-true invariant free by construction (no transport exists).

### 1.3 Route-set identity is asserted, not assumed (D1)

`assertHandlersMatchGroup(group, handlers, label)` runs at the end of
`implementSurface` / `implementSurfaces` / `extendSurface` and crashes at boot if
the bound tag set differs from `group.requests` in either direction — an
advertised tag nobody bound (a 404 at the far end) or a handler at a tag the group
never minted (dead code). Plus a per-`bind` duplicate-tag throw, the handler-side
twin of `defineSurface`'s `claim()`. The old "matcher tree depth / no
`/surface/surface/…` double-prefix" pins are restated on the tag axis in
`implementSurface.test.ts`, `implementSurfaces.test.ts` and
`extendSurface.test.ts` (each spells the expected key set literally **and**
compares it to `group.requests`).

### 1.4 `ServedSurface` / `ExtendedSurface`

`ServedSurface<S>` is now `{ surface, handlers, done, close }` (was
`{ surface, router, done, close }`). `ExtendedSurface` gains `group` + `handlers`
and drops `router`.

---

## 2. Member semantics — what was preserved, exactly

| member | before | now |
|---|---|---|
| cell `get` (authoring) | `yield store.get()` then relay bus | `Stream.concat(Stream.suspend(snapshot), channelStream(bus))` — snapshot still LAZY (taken at subscription, not at handler-build) |
| cell `get` (forward mirror) | `subscribeBeforeSnapshot`, `hasSnapshot` gate | identical, via the ported `subscribeBeforeSnapshot`; the gate's false arm is now the empty-array snapshot thunk |
| cell `set`/`patch`/`test__set` | equals-dedup → onWrite → store.set → bus.publish | identical, inside `Effect.sync` |
| cell forward writes | returned the forward's promise so oRPC awaited it | `Effect.promise` — the effect completes only once the upstream write did; an upstream rejection is a DEFECT (undeclared ⇒ `die`, D4) |
| collection `keys`/`get`/`deltas` | `subscribeBeforeSnapshot` generator | same function, `Stream`-shaped |
| collection `get` on absent key | held open, emits nothing | unchanged (still tested) |
| batched `deltas` | `createTickCoalescer` (microtask flush) | **verbatim**, untouched |
| stream member | promise snapshot-then-deltas from `deps.source` | same, `deps.source` returns a `Stream` |
| event member | forwards `deps.source(...)` with **NO wrapper** | same — forwarded directly, and the invariant is now pinned implementation-independently (§3) |
| procedures | `(opts) => handler({...opts, ctx})` | `(input) => impl({ input, ctx })` returning an `Effect` |
| reserved `system/{live,identity,clockNow}` | auto-answered on the namespace | auto-answered at the three tags; `identity` computed once, `clockNow` fresh per call |
| write path (`ctx.cells.X.set`) | equals(+`force`) → onWrite → store.set → bus.publish | **verbatim** |
| stores/channels | `inMemoryStore`, `inMemoryCollection`, `inMemoryChannel`, `inMemoryChannelByName`, `inMemoryPublisher`, `inMemoryCell`, `confStore`, `publisherChannel`, `ChannelOverflowError` | **verbatim** (comments de-oRPC'd only) |
| reactor `$` sibling bridge, derived-cell/collection narrowing, materialized view, `broadcastKeys` membership gating | — | **verbatim** |

`subscribeBeforeSnapshot` is preserved as the one machine that puts the
subscription strictly before the snapshot read. Its cleanup no longer needs the
single-iterator + `finally` dance: the subscription is a **scoped resource of the
stream**, so an early end — including one taken mid-snapshot — releases it exactly
once.

**Deliberately NOT changed**: the authoring cell's `get` still reads its snapshot
*before* subscribing (only the forward-mirror arm uses subscribe-before-snapshot),
because that is the shipped semantic and widening it would change frame counts for
every authored cell. Under `Stream.concat` the window is in fact *narrower* than
the generator's was (the second stream is pulled as soon as the first ends, rather
than on the consumer's second pull).

---

## 3. The two opposing ordering invariants (#7) — `src/streamOrdering.test.ts`

Written FIRST, then made to pass. Both name `kill.feature` in the file header.

- **(a) cross-channel delivery order = publish order.** A `terminalList` cell and
  a per-terminal `terminalExit` event; both subscribed; then two publishes in ONE
  synchronous tick. Asserted in **both** orders (cell-then-event and
  event-then-cell) so the test pins *publish order*, not "the cell always wins".
- **(b) a single-emission-then-complete event source delivers its value BEFORE
  end-of-stream.** The consumer records `value:…` then `end-of-stream`, and the
  assertion is the exact sequence — a regression that puts completion first, or
  drops the value, fails. A third case runs the same invariant through the
  framework-owned event channel.

Mechanism note: the old (a) was held by `iterateUntilAborted`'s one-microtask-per-
yield and the old (b) by `eventHandlers` adding no wrapper — a Stream port that
"preserved one microtask per yield" would have satisfied (a) and broken (b). Under
`Stream` both hold for free (FIFO fiber scheduling; a `Stream` cannot lose an
emitted element to its own completion), which is exactly why the TESTS are the
spec: nothing in the mechanism is claimed.

---

## 4. AbortSignal seam (D10 / #18) — dispositions, one by one

The framework's own code has **no `AbortSignal` left on any handler or any call
option**. Cancellation is fiber interruption, and it reaches the producer through
exactly two bridges, both in `server.ts`:

| helper | disposition | reason |
|---|---|---|
| `channelSubscription` (new, private) | **added** — the ONE `Channel<T>` → `Stream` bridge | acquire registers the subscriber synchronously (what lets subscribe-precede-snapshot hold); release aborts the subscription's own signal, which is the teardown `Channel.subscribe(signal)` already documents. Fiber interruption IS the unsubscribe. |
| `pullOnly` (new, private) | **added** | two decisions, both load-bearing: (1) it exposes **no `return` method**, because `Stream.fromAsyncIterable` installs an `Effect.promise(() => iter.return())` finalizer and AWAITS it — and an async GENERATOR parked at an `await` (every wrapper here: `iterateUntilAborted`, `pollOnEvent`) defers its `.return()` until that await settles, so awaiting it before the producer has been told to stop is a **guaranteed teardown deadlock** (observed: `Fiber.interrupt` hung forever until this was fixed); (2) it applies the abort-time swallow at the pull, which is the Effect-native home of `isAbortReason`'s rule. |
| `streamFromAbortableSource` (new, **exported**) | **added** | the D10 producer-edge bridge: `(signal) => AsyncIterable<T>` → `Stream<T>`, with the `AbortController` scoped to the stream. This is what a PTY tap / fs watcher / `fetch`-based sampler converts with, and it must be ONE conversion, not one per site. |
| `isAbortReason` | **KEPT, unchanged signature** | still the single home of the rule, now consumed by the two bridges above **and** by the cell-connector supervision (§5) **and** by three not-yet-migrated modules (`mirrorRemoteSurface.ts`, `project.ts` — Stage 3; `surface-remote/relayStream.ts` — later). Deleting it now would strand those with no Effect-native replacement in place. |
| `iterateUntilAborted` | **KEPT, unchanged signature** | its ORDERING job is gone (the fiber scheduler + `streamOrdering.test.ts` replace it; the doc comment on `publisherChannel` now says so explicitly). Its SWALLOW job still applies at the AsyncIterable layer, which `publisherChannel` and the three modules above still are. **Stage 3/4 should delete it** once `mirrorRemoteSurface`/`project`/`relayStream` are Stream-native. |
| `superviseTerminalSource` | **KEPT, verbatim** | it has no `AbortSignal` in its signature at all (`{done, close}` promises in, `{done, close}` out). Nothing to redesign. |
| `pollOnEvent` | **KEPT, AsyncIterable + `signal`** | it is itself the producer edge, and padi (`fsGitDeps`, `liveActivity`) consumes it directly. The walk now bridges it through `streamFromAbortableSource`, so there is still exactly one poll implementation. |

---

## 5. deps signature changes — the drishti/odu API-break list grows here

**Breaking (add to the follow-up list):**

1. `SurfaceRuntime.router` → **`{ group, handlers }`**. Every serving site changes.
   `ServedSurface.router` → `ServedSurface.handlers`.
2. `StreamImplDeps.source`: `(input, signal) => AsyncIterable<T>` →
   **`(input) => Stream<T>`**.
3. `EventImplDeps.source`: `(input, signal, {bus}) => AsyncIterable<T>` →
   **`(input, {bus}) => Stream<T>`**.
4. `ProcedureImpl`: was four arms with `{ input?, ctx, signal, errors }` returning
   `O | Promise<O>`; now **ONE arm**, `({ input, ctx }) => Effect<O, E>`.
   - `signal` is gone (interruption).
   - `errors` (the oRPC `ORPCErrorConstructorMap`) is gone: S1 replaced
     `ProcedureSpec.errors: ErrorMap` with a single `error` schema, so a declaring
     handler does `Effect.fail(new MyError({...}))` and the caller narrows on
     `_tag`. `ProcedureErrorCtors` / `ProcedureHandlerOpts` are deleted.
   - an input-less procedure now receives `input: void` (`Schema.Void`), an
     output-less one returns `Effect<void>` — the four arms collapse because
     `Rpc.make` resolves the three schemas positionally.
5. `CellHandlers` / `CollectionHandlers` / `StreamHandlers` / `EventHandlers` (the
   low-level escape hatches) changed shape: handlers take the payload **directly**
   (not `{input, signal}`) and return `Effect`/`Stream`.
6. Spec-derived dep types (`CellImplDeps`, `CollectionImplDeps`, `StreamImplDeps`,
   `EventImplDeps`, `SurfaceCtx`) now read the decoded type by **indexing the
   schema** (`Sc["Type"]`) instead of `infer`ring through `ZodType<infer T>` — the
   same rule `SurfaceTypes<S>` uses, so the dep types and the consumer-facing types
   cannot disagree about which side of a schema a position speaks. No behaviour
   change; type-inference sites that relied on zod inference must move.
7. **NEW export**: `streamFromAbortableSource` (§4) — the sanctioned way a consumer
   converts an AbortSignal-shaped producer.
8. **NEW exports**: `SurfaceHandler`, `SurfaceHandlerResult`, `SurfaceHandlers`.

**Explicitly NOT broken:**

- `CellConnector` keeps its `(cell, { signal }) => void | Disposer | Promise<…>`
  shape, and `Disposer` / `CellStore` are unchanged. This is **forced**:
  `reactor.ts` is lint-pinned and unmodifiable this stage, it imports `CellStore`
  and `Disposer` from here, and it is the sole producer of derived-cell/collection
  connectors (`connect(set, signal)` / `connectPoll(set, signal)`). Changing the
  connector seam means changing `reactor.ts`, which is out of scope. Recorded as a
  deliberate residual AbortSignal surface, not an oversight.
- `Channel<T>` keeps `subscribe(signal): AsyncIterable<T>` and `consume(...)`. It is
  a framework-independent pub/sub leaf with its own tests and out-of-package
  implementations; the ONE bridge to `Stream` is `channelSubscription`.
- All stores/channels keep their exported shapes and bodies.
- `implementSurface` / `implementSurfaceOnPublisher` / `implementSurfaces` /
  `implementSurfacesOnPublisher` / `extendSurface` keep their **argument** lists.

---

## 6. `extendSurface` on a flat tag namespace

The oRPC version passed two already-built router fragments *through*
`implement(combined).router({...})` so they re-adapted against the combined
contract's matcher meta, and hand-deep-merged the reserved `system` namespace per
verb. On a flat tag namespace neither is needed:

- composition is a plain record merge over the combined group (extension first,
  then base), because **a tag carries its own route**;
- collisions throw (claim semantics) — EXCEPT the three framework-reserved
  `system/*` tags, which every surface carries and which resolve
  **base-authoritative** (the base holds the re-served agent's identity + liveness
  gate). An app-owned `system.echo` has its OWN tag, so it survives by construction
  — the per-verb deep-merge is deleted, not reimplemented;
- the byte-identical-path guarantee is re-proved as **route-set identity**:
  `extendSurface.test.ts` asserts the merged handler key set equals
  `combined.group.requests` AND equals the union of the two inputs' tags, plus a
  direct `handlers[tag] === base.handlers[tag]` check for each reserved tag.

`mergeSurfaceSpecs` (flat per-name collision check across all kinds) is carried
over verbatim, so both collision tests (same-kind and cross-kind) still throw the
same message.

---

## 7. Gate

```
vitest run  (22 files, 247 tests)  → ALL GREEN
  gate-mandated: implementSurface, implementSurfaces, extendSurface,
                 streamOrdering (new), reactor, reactorEngineLaws, reactorFamily,
                 reactorLoopGuard, collectionDeltas, inMemoryChannel, heartbeat,
                 wait, channelNames
  additionally ported and green (server-owned, not gate-mandated):
                 cellHandlers, collectionKeysMembership, liveness,
                 surfaceRuntimeSupervision, pollOnEvent
  Stage-1 suites still green: define, clockNow, errors, collectionDeltasSchema

tsc --noEmit → ZERO errors in every file this stage owns
biome lint --error-on-warnings (13 owned files) → clean
just fmt → run
```

### Files owned by Stages 3/4 that still fail `tsc` (excluded from the gate run)

| file | owner |
|---|---|
| `src/solid/keyedSubscriptionCache.test.ts`, `solid/collectionDeltasGate.test.ts`, `solid/surfaceClient.{readonly,health,policy}.test.ts`, `solid/boundProcedure.test-d.ts`, `solid/boundCollection.test-d.ts`, `solid/createLiveSignal.test.ts`, `solid/surfaceClient.ts`, `solid/liveSignal.ts` | Stage 3 (client face) |
| `src/project.ts`, `src/project.test.ts` | Stage 3 |
| `src/mirrorRemoteSurface.test.ts`, `src/mirrorPumpOwnership.test.ts` | Stage 3 (the mirror consumes the client face) |
| `src/links/direct.test.ts`, `src/peer-server.test.ts`, `src/unix-socket.test.ts`, `src/procedureErrors.test.ts` | Stage 4 (transports; `procedureErrors` runs over a real `serveOverStdio`+`stdioLink` wire) |

`src/mirrorRemoteSurface.ts` itself compiles (it is `Channel`/AsyncIterable-based
and still sees `isAbortReason`/`iterateUntilAborted`); only its test is red.

---

## 8. Things a later stage owns that `server.ts` still hosts — precise notes

1. **`iterateUntilAborted` + `isAbortReason` are transitional.** They are exported
   from the SERVER module but their only remaining consumers are the mirror/relay
   layer and `publisherChannel`. Once Stage 3 makes `mirrorRemoteSurface`/`project`
   Stream-native and `surface-remote/relayStream` follows, `iterateUntilAborted`
   should be deleted and `isAbortReason` should shrink to whatever the connector
   seam still needs. I did **not** half-move them.
2. **`CellConnector`'s AbortSignal is a reactor coupling, not a server choice.**
   Whoever unfreezes `reactor.ts` should retire `{signal}` + `Disposer` in favour
   of a `connect: (cell) => Effect<void>` with `Effect.addFinalizer`, and the
   `starts`/`SurfaceSource` machinery collapses into `Effect.forkScoped` at the same
   time. Doing it now would have meant editing a lint-pinned file.
3. **`StreamImplDeps`'s poll arm stays Promise-based** (`read: (input) => Promise<T>`)
   because `pollOnEvent` is the shared implementation and padi consumes it directly.
   When W4 moves padi, both should become `Effect`-returning together.
4. **`handlerDispatch.testlib.ts` is a test-only dispatch helper**, not an export.
   If Stage 3's in-process dispatcher subsumes it, delete it and re-point the tests.

---

## 9. Deviations from the brief, with reasons

1. **The event/stream `deps.source` signature drops `signal` but the CELL
   `connect` keeps it.** The brief said "member `deps` sources become Effect-native
   … cell/collection deps" too; `reactor.ts` being unmodifiable makes the cell
   connector immovable this stage. Recorded in §5 and §8.2.
2. **`publisherChannel` keeps its `iterateUntilAborted` wrapper.** The brief invited
   deleting reason-swallowing helpers; here the wrapper's ORDERING justification is
   dead (documented in place) but its SWALLOW justification still applies to
   consumers outside this stage's scope. Removing the wrapper would change
   behaviour for padi/kolu-server/examples in a stage that does not own them.
3. **The authoring cell's `get` keeps snapshot-then-subscribe** (not
   subscribe-before-snapshot) — see §2. Behaviour-preserving choice.
4. **Four server-owned suites beyond the gate list were ported** (`cellHandlers`,
   `collectionKeysMembership`, `liveness`, `surfaceRuntimeSupervision`). They test
   Stage-2 semantics and would otherwise have rotted; `liveness.test.ts`'s served
   half is the one S1 explicitly deferred to this stage, and it is now green against
   a real `implementSurface` (through a minimal hand-built probe face — Stage 3 still
   owns the real client face).
5. **Two "snapshot→subscribe gap" tests were re-expressed.** They used hand-driven
   async-generator pulls, which have no `Stream` analogue. They now publish from
   INSIDE the framework's own snapshot read, which is a *sharper* probe of
   subscribe-before-snapshot: if the subscription opened after the snapshot the
   frame would reach zero subscribers and `Stream.take(2)` would hang. One of them
   also documents that the snapshot may already reflect the in-flight add — the
   benign, already-documented double-delivery.

## 10. Nothing here invalidates a PLAN assumption

- D1's route-set identity is now enforced on BOTH sides (group + handlers) and
  asserted at boot.
- D3's snapshot-then-deltas stays handler-enforced, unchanged.
- D4's "undeclared throw is a defect" is realised: an upstream forward rejection
  and a channel-level fault both `die` rather than masquerading as a member failure.
- D7's `Channel<T>`/`inMemoryPublisher` survive untouched; the ordering spec is now
  the two unit tests, as D3 required.
- D10's AbortSignal seam is closed inside the framework, with the one residual
  (`CellConnector`) named and attributed.
- No `package.json` `dependencies` block changed, so PLAN standing rule 5 does not
  fire for this stage.
