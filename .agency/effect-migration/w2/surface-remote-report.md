# W2 fanout — `@kolu/surface-remote` on the Effect surface core

Scope: the whole package (30 test files, 289 tests). Zero `zod` / `@orpc/*`
imports remain anywhere in `src/`.

Built against the committed core: S1 (`Surface {group, tagPrefix, spec}`, the tag
algebra, `@kolu/surface/errors`), S2 (`SurfaceRuntime {group, handlers}`,
`StreamImplDeps.source: (input) => Stream`, `CellForward`), S3
(`SurfaceDispatch`, `buildSurfaceFace`, `directDispatch`, `shouldRetryStreamError`,
`mirrorRemoteSurface` Stream-native), S4 (`stdioLink` async on `{group,…}` →
`{dispatch, dispose}`), plus `@kolu/surface-map`'s new
`EntrySession.dispatch` / `ServeSurfaceMapResult {group, handlers}`.

---

## 1. The shapes that changed

### 1.1 `AgentClient` — the ssh dial's client is the FACE

```ts
export type AgentClient = SurfaceFace;            // was AgentClient<C extends AnyContractRouter>
```

Non-generic and structural. The oRPC `ContractRouterClient<C, ClientRetryPluginContext>`
had no successor to be generic over: the retry plugin's context is gone (the fence
is a `Stream` combinator now), and D2 puts per-member precision in the SPEC-derived
bound faces, never in a second mapped type over the addressing layer. Every consumer
in this package already walked the client structurally
(`probeSurfaceLive` / `probeSurfaceIdentity` / `measureSurfaceClockOffset` /
`mirrorRemoteSurface` / `surfaceMember`), so nothing downstream of the connector
changed shape.

### 1.2 `sshConnector` takes the SURFACE as a value

```ts
sshConnector<S extends SurfaceSpec>(opts: {
  surface: Surface<S>;   // NEW, REQUIRED
  host; binary; resolveDrvPath; extraArgs?; localEnv;
}): Connector<AgentClient, SshProv>
```

The type parameter `C extends AnyContractRouter` was never a value — oRPC could
mint a client from a type alone. Effect RPC cannot: `stdioLink` needs the flat
`RpcGroup` (`surface.group`), and the face needs `surface.spec` + `surface.tagPrefix`.
Passing the surface is also what makes the dialled face and the served group
provably the same tag set, instead of two derivations that could drift.

Inside, the dial is now:

```ts
const link = await stdioLink({ group: opts.surface.group, read: child.stdout, write: child.stdin });
const client = buildSurfaceFace(opts.surface, link.dispatch);
```

`teardown()` disposes the LINK first (its scope holds the protocol's dial/ping/
response fibers — S4 §1) and then kills the child. Without that every dial leaked a
protocol fiber; the old sync `stdioLink` had no scope to release.

`dialAgentOnce<S extends SurfaceSpec>({ surface, … })` follows, returning the
non-generic `AgentDial { client, dispose }`.

### 1.3 `reServeSurface` returns `{ group, handlers }`

`ReServedSurface.router: unknown` → **`group: RpcGroup<Rpc.Any>` + `handlers:
SurfaceHandlers`** — the same pair `implementSurface` and `serveSurfaceMap` hand
back, so a host merges one value pair and a tag carries its own route (nothing to
re-prefix at the mount site). The deps it feeds `implementSurfaceOnPublisher` moved
with S2: stream/event `source` returns a `Stream`, procedures return an `Effect`,
cell `forward` stays the promise-shaped `CellForward`.

### 1.4 `serveHostMap`: `linkFor` → `dispatchFor`, `KS extends WireSchemaAny`

```ts
serveHostMap<KS extends WireSchemaAny, …>(map, pool, {
  dispatchFor: (host: K, session: S) => SurfaceDispatch;   // was linkFor: (…) => unknown
  connection?; failureOf;
}): ServeSurfaceMapResult          // { group, handlers, dispose }
```

`EntrySession.link: unknown` became `EntrySession.dispatch: SurfaceDispatch`
upstream, so the injected producer is TYPED now — the old `unknown` existed only
because an oRPC nested-proxy tree had no nameable type. `z.ZodType`/`z.infer` →
`WireSchemaAny`/`KS["Type"]` throughout.

### 1.5 `ObservableHolder.whenChanged` → `changed`

```ts
interface ObservableHolder<T> extends LiveSpawnHolder<T> {
  readonly changed: Effect.Effect<void>;   // was whenChanged(signal?): Promise<void>
}
```

Its ONE consumer is the relay's rebind wait, which is a `Stream` now: cancellation
is fiber interruption, so there is no `AbortSignal` to thread. `Effect.callback`'s
finalizer detaches the waiter, which is exactly what the old
`signal.removeEventListener` pair did — same guarantee, nothing to forget.

---

## 2. `relayStream.ts` — the two relays on `Stream`

Both cores are now `(input: I) => Stream<F, …>` — the same
`StreamingProcedure` shape `StreamImplDeps.source` wants, so the re-serve grafts
them straight on. No `AbortSignal` anywhere; every "the downstream walked away"
`return` in the old async generators has no counterpart to write, because
interruption is not an outcome the relay reports.

| law | before | now |
|---|---|---|
| hold-open: FAILURE ⇒ rebind, clean END ⇒ end downstream | `try/catch` around `for await` | `Stream.onEnd` (the log + the typed end) then `Stream.catch` (the rebind). Interruption never reaches `catch`, so a torn-down subscription cannot rebind. |
| hold-open: wait for the first spawn | `while (client === null) await whenChanged` | `awaitLiveClient` — a plain EFFECT loop, so a link that flaps to `null` and back N times before a spawn costs no stream nesting |
| fail-through: pre-spawn WAIT, not fail (#1963) | same, rate-limited log | same, rate-limited log |
| fail-through: application error unchanged, transport death ⇒ named end | `isMiddleHopTransportLoss` on `ORPCError` | same predicate, re-derived (below) |
| missing member ⇒ loud, never a "link blip" | throw outside the try | throw inside the relay's own effect ⇒ a DEFECT (D4), which the downstream fence never retries |

`RelayTransportLostError` now **extends `SurfaceRelayTransportLost`** from
`@kolu/surface/errors`. Subclassing rather than re-declaring is what makes it
survive the relay hop: both ends were built from the SAME schema, so it
`encode → JSON → decode → encode`s with `_tag` and `reason` intact
(verified: `{"_tag":"SurfaceRelayTransportLost","reason":"…"}`), `instanceof`
narrowing still works on the subclass, and `shouldRetryStreamError` returns `true`
for it. The raw upstream error rides `cause`, which deliberately does NOT cross the
wire — `reason` is the part both ends read.

**`isMiddleHopTransportLoss`, re-derived.** The oRPC rule was "an `ORPCError` is an
application error; anything else is transport". The Effect successor:

```ts
isSurfaceRelayTransportLost(e)   // a nested re-serve's own named end
  || isDeadTransportError(e)     // SurfaceTransportRetired | SurfaceStdioTransportClosed
  || isTransportError(e)         // RpcClientError, matched by _tag
  || !isTaggedFailure(e)         // an UNTAGGED failure — the exact "not an ORPCError" arm
```

The last arm is the load-bearing one: a failure with no `_tag` is a raw
transport/network rejection nobody declared. A TAGGED failure that is none of the
three transport tags is, by construction, something a schema declared — so it
surfaces unchanged and stays non-retryable.

---

## 3. `reServeSurface` — the two forward channels split (D4)

The oRPC version collapsed both outcomes into `ORPCError("SERVICE_UNAVAILABLE")`
vs a re-thrown `ORPCError`. Under Effect they are different channels, and the
difference is real:

- **"no live upstream link"** → a new `UpstreamUnavailableError` (a plain `Error`,
  NOT a D4 tagged error) raised as a **DEFECT**. No source surface can DECLARE the
  re-serving parent's own transport state — a re-served procedure's error schema is
  the AGENT's — so there is no channel it could travel on as a declared failure.
  A defect is also what makes it non-retryable downstream, which is exactly what the
  old `SERVICE_UNAVAILABLE` achieved by being sanitized on the way out.
- **an APPLICATION failure the agent raised** → re-`Effect.fail`ed VERBATIM. It was
  decoded against the agent's own declared error schema on the way in, so re-failing
  re-encodes it against the SAME schema on the way out and a downstream caller
  narrows on `_tag`. Pinned by a new `EchoRejected` tagged error declared on the toy
  surface's `ctl.echo`.
- a CELL write has no declared error channel at all (the framework owns the member),
  so an application rejection there crosses as a defect carrying its own message —
  never re-labelled as an upstream outage. Both arms are pinned separately.

`session.currentState().phase !== "connected"` still wins over the raw error, so a
link drop MID-forward is reported as unavailable with the raw error on `cause`
(unchanged law, new vocabulary).

---

## 4. PLAN D6 — the pre-`clockNow` probe, re-derived

`session.ts:1440` classified `err instanceof ORPCError && err.code === "NOT_FOUND"`
as EXPECTED-ABSENT alongside the client-side `ClockNowUnavailableError`. **The
server-side arm is deleted.** Under the flag day a peer either speaks THIS protocol
epoch — in which case its group carries the reserved `system/clockNow` tag, because
`defineSurface` mints it and `implementSurface` asserts route-set identity at boot
(D1) — or it cannot decode a frame at all and the dial never reaches a probe. A
far-end refusal of this tag is therefore no longer an older-server condition to
expect: it is a framework defect or a genuine transport fault, and both belong in
the loud, RETRIED arm. Reading it as expected-absent would silently stop probing a
peer that should answer.

The LOCAL arm survives unchanged: `ClockNowUnavailableError` is raised by this
process about the shape of the client object in its own hand (an endpoint connector
whose client is not surface-shaped), and stays `debug` + not-retried.

---

## 5. A REGRESSION Effect RPC introduced, and the fix (session.ts)

**Found by `liveness.test.ts`, not by review.** Effect RPC's socket protocol carries
a built-in 5 s ping/pong keepalive. A silently WEDGED peer (process alive, app hung
— no stdio EOF, ssh keepalive ~30 s away) now fails the LINK within ~10 s, and
because a stdio leg never reconnects (`neverReconnect`), every later call rejects
with `SurfaceStdioTransportClosed`. The session's watchdog contract says *"a
rejection still counts as ALIVE (the round-trip completed)"* — so the wedged link
would have been reported alive FOREVER: no `closed` fires while the wedged child
lives, so the session parks `connected` over a corpse. That is the
green-dot-over-a-dead-link lie, one hop out.

Fix, at the seam that already owns the rule (`makeSession`'s heartbeat `probe`): a
DEAD-TRANSPORT rejection is the one rejection that is not an answer at all, so it
force-cycles NOW instead of waiting out a timeout the link can no longer meet. This
is the same verdict `onStale` reaches for a wedged remote, taken one signal earlier
and on harder evidence — and it needs no process oracle, because a dead transport
cannot be reused whether or not the far process is alive. Guarded on
`destroyed`/supersession like the `finally` beside it. Covers every connector
(ssh, kolu's local padi arm, drishti's), not just the ssh one.

`liveness.test.ts`'s wedged-link test is restated on the LAW ("force-cycled within
one watchdog cycle, never left reporting connected over a corpse") with the
mechanism change written down, rather than on the old interval+timeout arithmetic.

---

## 6. zod → Effect Schema

| site | before | after |
|---|---|---|
| `ConnectionInfoSchema` | `z.discriminatedUnion("phase", […])` | `Schema.Union([…])` — **not** `TaggedUnion` (the discriminant is `phase`, not `_tag`, and the bytes are frozen) |
| its `log` | `z.array(LogEntrySchema).readonly()` | `Schema.Array(EvidenceLineSchema)` (already readonly on the Type side) |
| `clockOffset` | `z.number().nullable()` | `Schema.NullOr(Schema.Number)` |
| `cause` | `z.enum(["network","remote"])` | `Schema.Literals(["network","remote"])` |
| `sessionConnection`'s `safeParse` | `ConnectionInfoSchema.safeParse` | `Schema.decodeUnknownResult(…)` built ONCE at module scope (it runs on the host-map status hot path) + `Result.isFailure` |
| `AgentBinaryCacheSchema` | `z.array(z.string().trim().min(1)).min(1)` | `Schema.Array(Schema.Trim.pipe(Schema.decodeTo(Schema.String.check(Schema.isMinLength(1))))).check(Schema.isMinLength(1))` |
| `z.prettifyError(err)` | — | `SchemaError.message` (the rendered issue tree), collapsed onto one line; the LOUD THROW is preserved verbatim |
| `serveHostMap`'s `z.ZodType`/`z.infer` | generic plumbing | `WireSchemaAny` / `KS["Type"]` |
| test brands (`z.string().brand("HostKey")`) | — | `Schema.String.pipe(Schema.brand("HostKey"))` |

**`.trim()` is a TRANSFORM, not a check.** zod's `.trim()` rewrote the value and
then applied `.min(1)` to the TRIMMED result, so `"  "` was rejected and
`"  https://c  "` was normalised. `Schema.String.check(isNonEmpty)` would accept
`"  "` and hand nix an untrimmed substituter — the "looks like a cache miss"
failure the docstring names. `Schema.Trim.pipe(Schema.decodeTo(…))` reproduces both
halves; verified live (`"  https://c  "` → `"https://c"`, `"  "` → rejected).

### Byte-compat hit list

`ConnectionInfoSchema` is on the hit list (it crosses the ssh mirror hop as the
host-map entry's fine `connection` payload, cross-repo with drishti). **New
`describe` in `connection.test.ts` asserting the encoded JSON STRING literally** for
an UP arm, both `connected` shapes and both DOWN arms — e.g.

```
{"phase":"connected","clockOffset":null,"log":[{"source":"local","line":"up"}],"sinceMs":5,"campaignEpoch":2}
```

Cross-checked against the zod original: identical bytes, field order included,
`clockOffset: null` staying a real `null` rather than an absent key.

**No `.optional()` / `.default()` idiom exists in this package**, so #17's mapping
table has no call site here; it is stated in `connection.ts`'s header for future
authors.

---

## 7. Public API breaks (drishti / odu follow-up list)

1. **`AgentClient<C>` → `AgentClient`** (non-generic, `= SurfaceFace`). Every
   `AgentClient<typeof myContract>` breaks.
2. **`sshConnector` requires `surface: Surface<S>`** and is generic over the SPEC,
   not a contract: `sshConnector<C>({host,…})` → `sshConnector({surface, host,…})`.
   `SshConnectorOptions` gained a type parameter.
3. **`dialAgentOnce` requires `surface`**; `DialAgentOnceOptions<S extends
   SurfaceSpec>`; `AgentDial` is non-generic.
4. **`ReServedSurface.router` → `{ group, handlers }`.**
5. **`ServeHostMapOptions.linkFor` → `dispatchFor`, returning a typed
   `SurfaceDispatch`** (was `unknown`). `serveHostMap`'s `KS` bound is
   `WireSchemaAny`, and it returns `{ group, handlers, dispose }` (was
   `{ router, dispose }`).
6. **`ObservableHolder.whenChanged(signal?): Promise<void>` → `changed:
   Effect<void>`.**
7. **`RelayTransportLostError extends SurfaceRelayTransportLost`** — no `.code`
   any more; recognise it by `_tag === "SurfaceRelayTransportLost"` or the exported
   `isSurfaceRelayTransportLost`. `error.code === "SURFACE_RELAY_TRANSPORT_LOST"`
   breaks.
8. **The relay cores return `Stream`**: `relayHoldOpenStream` /
   `relayFailThroughStream` / `holdOpenStreamCore` / `failThroughStreamCore` are
   `(input) => Stream<F,…>` (was `(input, signal) => AsyncGenerator<F>`).
   `ForwardableStream.get` is an `UpstreamSource` = `(input) => Stream<F>`.
9. **NEW exports**: `UpstreamUnavailableError`, `RelayedStream`,
   `TEST_AGENT_SURFACE` (on the `./agentDerivation.testutil` subpath).
10. **`reServeSurface`'s "no live upstream link" is a DEFECT** carrying
    `UpstreamUnavailableError`, not an `ORPCError("SERVICE_UNAVAILABLE")`; a
    consumer matches the message, not a code.
11. `session.ts` no longer treats a far-end `NOT_FOUND` on `system/clockNow` as
    expected-absent (§4) — a peer that refuses it now logs at `error` and is
    retried.
12. `ConnectionInfoSchema` / `LogEntrySchema` are Effect Schemas; `.parse` /
    `.safeParse` are gone (use `Schema.decodeUnknownSync` /
    `Schema.decodeUnknownResult`).

---

## 8. Deviations / deliberate non-changes, with reasons

### 8.1 The face is STRUCTURAL, and this package hands out no spec-typed client

`buildSurfaceFace` returns the structural `SurfaceFace`; the spec-typed bundle
(`buildSurfaceClient`) needs a `live` accessor, and `surfaceClient` REFUSES a bare
half-open-branded dispatch by design (S3 §1). A stdio consumer's honest liveness is
`makeSession`'s own heartbeat, which the session does not expose as an `Accessor`.
So a CLI that wants `.cells.foo.use()` over a dialled agent has no supported path
today. Recorded rather than papered over — it is W5's call whether `dialAgentOnce`
should hand back a `LiveSignalHandle`-shaped pairing.

### 8.2 `runStreamScoped` has no non-Solid subpath, so two test files restate it

`@kolu/surface`'s `runStream.ts` lives at the package root precisely because it has
nothing to do with Solid, but it is only re-exported through
`@kolu/surface/solid` — which a node package cannot import without dragging
`solid-js` in. `relayStream.test.ts` and `reServeSurface.test.ts` therefore carry a
~25-line `drain()` restating its three rules (stopper latches first, interruption is
not a failure, nothing reports after the stop). **Core ask for the reconcile pass:
add `"./run-stream": "./src/runStream.ts"` to `@kolu/surface`'s exports** and delete
both copies. I did not edit the core.

### 8.3 `controllableStream.testutil` is a `Queue`, not an async generator

The obvious port (`Stream.fromAsyncIterable` over the old generator) is a teardown
DEADLOCK — `fromAsyncIterable` installs an `Effect.promise(() => iter.return())`
finalizer and AWAITS it, while an async generator parked at `await` defers its
`.return()` until that await settles, and this one's await is only settled by a push
that will never come once the consumer is gone (the exact shape S2 measured hanging
`Fiber.interrupt` forever). `Stream.callback` + `Queue.offerUnsafe` /
`endUnsafe` / `failCauseUnsafe` has no such coupling. Frames pushed before the
subscribe are buffered and replayed, so a test can still seed a snapshot without
racing the subscription.

### 8.4 Hold-open rebinding nests one `Stream.catch` frame per upstream BLIP

The rebind is stream-level recursion (`catch → attempt()`), so N link blips during
ONE downstream subscription cost N nested frames. The null-client wait is NOT
recursive (it is an effect loop), so the common case — provisioning, where
`.current` flaps repeatedly before the first spawn — is flat. A blip needs a live
client that then dies mid-stream, which is bounded by the reconnect cadence.
Recorded rather than hidden; the alternative (a queue-driven push loop) would trade
backpressure for flatness.

### 8.5 `surfaceLiveProbe` keeps its "a rejection counts as alive" contract

The dead-transport classification (§5) is done at the heartbeat `probe` in
`makeSession`, NOT inside `surfaceLiveProbe`, because that function returns a bare
`() => Promise<void>` with no access to the connection, and because doing it once at
the session covers every connector rather than only the ones that use the default
probe.

### 8.6 `reconnect-spin.test.ts`'s premise is dead; its LAW is not

The test existed because the oRPC client was a thenable proxy. The face is a plain
object, so the trap has no spelling — but the law it measures is the CURSOR's
(`waitForNextClient` keys on the `clientPromise` identity, so a consumer loop makes
a handful of attempts across a reconnect, never thousands), and that is still
exactly what the test asserts. The header says so instead of pretending the old
hazard is live.

### 8.7 No `package.json` change

`effect` and `@effect/platform-node` were already declared. `zod` /
`@orpc/{client,contract}` (and the `@orpc/server` devDep) are now UNUSED but still
declared — W6 owns the purge, and removing them here would fire PLAN standing rule 5
(`nix/workspace.nix` + `default.nix` stableLeaves) for no benefit. **Standing rule 5
does not fire for this package.**

### 8.8 Docs deferred, per the S3 / surface-map precedent

`.claude/rules/surface-reference.md` requires
`website/src/content/surface/ref-surface-remote.mdx` to move with §7. The map's and
the core's Reference pages are being rewritten in the same worktree right now, so a
rewrite landed here would be stale before it was read; PLAN W6 already owns
"examples + website surface reference MDX", and §7 is written as the changelog that
pass consumes. **Flag it if W6 slips.** The package README's one code snippet WAS
updated (it now names `surface`).

---

## 9. Test inventory

| file | note |
|---|---|
| `relayStream.test.ts` | **REWRITTEN** — 13 tests. Every "downstream aborts" case is now a fiber INTERRUPT, and each asserts the stronger law ("reports NOTHING", including that a spawn landing after the teardown wakes nothing). +1: the lead frame is re-emitted on the REBIND, not just the first bind. +1: an interrupted hold-open leaves no waiter behind. The declared-error arm uses a real tagged error (`MapKeyUnknown`) instead of `ORPCError("NOT_FOUND")`. |
| `reServeSurface.test.ts` | **REWRITTEN** — 18 tests, all originals preserved. The fake agent is Stream-shaped; the downstream is `buildSurfaceFace(toySurface, directDispatch(served))`. The back-pressure test stalls its consumer with an Effect gate instead of a hand-driven async iterator. Two arms split out of the old "preserves application errors" test (declared procedure error re-fails typed; cell write crosses as a defect). |
| `serveHostMap.test.ts` | ported — 21 tests. `entriesGet` reads through the real `entries` face (`defineSurface({collections:{entries: map.entriesSpec}})`, the SAME surface `connectSurfaceMap` builds its membership face from, so a drift 404s here as it would in production). A local pull-`reader` replaces the async iterator for the pins that interleave a mutation between frames. |
| `connection.test.ts` | ported + **NEW `describe`**: the ENCODED bytes of every arm (§6). |
| `liveness.test.ts` | ported; the wedged-link test restated on the law (§5). |
| `recheck.test.ts`, `reconnect-spin.test.ts` | the oRPC `oc`/`eventIterator`/`implement` fixture replaced by a real `defineSurface` + `implementSurface` + `serveOverStdio({group, handlers})` agent. |
| `hostFanout.test.ts` | ported; the fake client's `ticks` is a `Stream`. |
| `identityNotify.test.ts`, `hostSession.test.ts`, `localSpawnEnv.test{,-d}.ts`, `terminalGiveUp.test.ts`, `sessionLoggerSink.test.ts`, `dialAgentOnce.test.ts` | mechanical: `surface:` added at the `sshConnector`/`dialAgentOnce` call sites (a shared `TEST_AGENT_SURFACE` in `agentDerivation.testutil.ts` so twelve suites don't each invent one). |
| `connectionInfoIdentity.test-d.ts` | `z.infer<…>` → `typeof ConnectionInfoSchema.Type`; the pin itself is unchanged. |
| `reServeSurface.variance.test-d.ts` | the dead contract parameter is gone from both ends; the covariance pin (a specific session assigns to the loose receptacle, drishti's un-annotated `pumpRemoteSurface` call) is unchanged. |
| `arch`, `nixCopy`, `provisions`, `controlMaster`, `processExit`, `processLifetime`, `agentDrv`, `agentDerivation`, `closedInfo`, `probingEpisode`, `currentState`, `admitTimeout`, `warmProbeCheck`, `livenessOrdering`, `clockProbe`, `host`, `daemonSession`, `progressTail`, `waitForNextClient` | untouched — green before and after. |

---

## 10. Gate

```
tsc --noEmit                                          → ZERO errors
vitest run                                            → 30 files, 287 passed, 2 skipped
KOLU_DAEMON_TESTS=1 vitest run                        → 30 files, 289 passed, 0 skipped
biome lint --error-on-warnings packages/surface-remote → clean (64 files)
biome format --write packages/surface-remote           → applied (scoped, NOT repo-wide:
  another agent is editing packages/surface concurrently in this worktree)
grep for `zod` / `@orpc` across src/                   → NO hits
```

Four `packages/surface/src/*` files are dirty in this worktree from a concurrent
agent; they are NOT staged in this commit.

---

## 11. Nothing here invalidates a PLAN assumption — with three notes

- **D2 holds**: the ssh dial's client is the addressing face over the erased
  dispatch, typed from the spec nowhere and structurally everywhere — but §8.1
  records that this package currently offers no path to the spec-typed bound faces
  for a stdio consumer.
- **D4 holds and got sharper**: the relay's retryable end IS the shared
  `SurfaceRelayTransportLost` (subclassed, so it survives the hop by schema rather
  than by a magic code), and the re-serve's two forward outcomes are now two
  channels rather than one `ORPCError` with a code.
- **D6 holds**: the pre-epoch tolerance in the clock probe is deleted, with the
  reason written where the code was (§4).
- **D10 holds**: no `AbortSignal` remains in the relay path, in `ObservableHolder`,
  or in any procedure/stream forward. The residual `AbortSignal`s are the
  connector's own (`ConnectContext.signal`, threaded into `spawn`/`provisionAgent`
  child lifetimes) and `MirrorRemoteSurfaceOptions.signal` — both PRODUCER-edge
  signals the core itself kept, not framework seams.
- **#12 is honoured**: nothing in this package retries a call; the fail-through
  relay's whole job is to END loudly so the consumer's own fence re-subscribes.
- One REGRESSION found and fixed in-package (§5), and one CORE ask recorded for the
  reconcile pass (§8.2 — a `./run-stream` subpath export on `@kolu/surface`).
