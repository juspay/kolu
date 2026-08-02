# W4 — `padi` SLICE B1: daemon boot Layer graph + the Effect-native serve

Scope delivered: everything in `packages/padi` EXCEPT `src/upgradeWindow/**`
(a follow-up agent owns that harness). Plus three `readonly`-propagation lines in
`packages/transcript-html/src/index.tsx`, which padi's own `tsc` compiles through
a project reference and which slice A's schema change turned red.

`package.json` is UNCHANGED — `@effect/platform-node` and `effect` were already
declared dependencies — so PLAN standing rule 5 does not fire.

---

## 1. The boot Layer graph (PLAN D9)

`daemonBoot/daemonMain.ts`'s hand-rolled phase-token pipeline is now five
`Context.Service` classes and five `Layer`s:

```
PadiGate ──▶ PadiStores ──▶ PadiIdentity ──▶ PadiSurfaces ──▶ PadiEndpoint
```

Each layer is built by an effect that CONSUMES the service of the phase before
it (`PadiGate.useSync(...)`, `PadiStores.useSync(...)`, `PadiIdentity.use(...)`,
`PadiSurfaces.use(...)`), so the ordering the tokens used to prove by threading a
value is now proved by the graph's **dependency arrows** — the same compile-time
guarantee, expressed as `Layer.Layer<Out, E, In>` rather than as a parameter
list. `Layer.provideMerge` assembles them, so the program below reads the held
gate and the served wire off the same graph that ordered them.

Two things the Layer form buys that the tokens could not:

1. **Teardown is a scoped finalizer.** `surfacesLayer` acquires the surface
   runtime with `Effect.acquireRelease`, so `runtime.close()` runs when the scope
   closes — on a clean stop OR on a later phase's failure. The old
   `try { … } finally { await served.close() }` is deleted with the scope that
   replaced it. Disposition unchanged: loud-not-fatal, `close` resolves cleanly
   and never faults `done`.
2. **The gate's refusal arms are typed.** `held` / `dir-not-private` were early
   `return`s the compiler could not see; they are now an `Effect.fail(new
   GateRefused(exit))` on the gate layer, which makes every downstream layer
   unreachable BY CONSTRUCTION. `runPadiDaemon` catches it and maps it straight
   back to the `DaemonExit` the spine expects, so the observable behaviour — and
   `daemonMain.test.ts`'s "touching NOTHING" assertions — are byte-identical.

The phase FUNCTION BODIES were not rewritten. `openStateStores`,
`configureDaemonIdentity`, `serveDaemonSurfaces` and `bootLocalEndpoint` keep
their exact statements and order; only their token parameters/returns moved into
the graph. That is deliberate: the boot is padi's production path, and the point
of this change is the ordering proof and the scoped release, not a re-derivation
of what the boot does.

`serveDaemonSurfaces` also lost the `Router<any, any>` cast and its
`biome-ignore lint/suspicious/noExplicitAny`: `DaemonSpec` takes flat
`{ group, handlers }` now (surface-daemon-report §1), forwarded verbatim, spelled
the same way on both sides.

### 1.1 The run edge — deviation from the brief, with reasons

The brief asked for `NodeRuntime.runMain`. **`bin.ts` keeps `daemonProcessMain`**
and padi's `run` is ONE `Effect.runPromise` inside `runPadiDaemon`. Reasons:

- `daemonProcessMain` is the SHARED spine's process edge. kaval rides it too, and
  it owns `daemonExitCode(exit)` + the crash arm, pinned by surface-daemon's
  `tenure.test.ts` real-child tests. Swapping padi onto `NodeRuntime.runMain`
  would mint a second authority for the same exit-code map and split the two
  daemons that deliberately share one.
- `bin.ts`'s `parseArgs` front, the `--stdio` branch and the
  `installUnhandledRejectionBoundary` placement are untouched, which is what the
  brief's "or the minimal equivalent that preserves bin.ts's arg parsing" asks
  for.
- `runPadiDaemon` is ALSO the in-process test harness entry
  (`daemonMain.test.ts`), so it has to stay Promise-shaped regardless.

So padi's daemon tier has exactly ONE `Effect.run*` call site
(`daemonMain.ts`'s `runPadiDaemon`) plus one in the tap layer
(`local.ts`'s `bridgeStream`, §4) — both named here for W6's allowlist test
(#25).

### 1.2 The ~15 module singletons — NOT converted, and why

The brief's D9 list (recon `consumers.md` §padi) also names the
`lateBoundSurfaceCtx` proxy, the conf-store set/require pairs, `ptyHost/index.ts`'s
`endpoint`/`triggerRestart`/`infoPromise` lets and the forwarding `Proxy`,
`daemonStatus`'s maps, the terminal-registry `Map`, `terminals.activeTerminalId`,
`autosaveGate`, `koluRoot.daemonProcessId`, `log.ts`'s active logger,
`servePadi.standingFinishQuiet`, `unhandledRejectionBoundary`'s lets, and
`sensors.activations`. **They stay module-level.** This is a deliberate stop, not
an oversight:

- Every one of them is read from SYNCHRONOUS domain code deep inside call stacks
  that are not Effects — `padiSurfaceCtx.collections.terminals.upsert(...)` from
  `metadata.ts`, `ptyHostClient.surface.terminal.kill(...)` from `local.ts`'s
  teardown, `requirePadiSessionStore()` from a cell store's `get`. Turning them
  into `Context.Service`s means either threading `R` through ~13k lines of
  non-Effect domain code (the whole package, and PLAN locked decision 1 keeps the
  leaves plain), or capturing a boot-time `Context` in a module global and
  reading it through an accessor — which is the SAME global with more ceremony.
  Neither is an improvement, and the second is worse because it hides the global
  behind an idiom that promises it is gone.
- The one genuinely-structural win available in that list — collapsing
  `ptyHost/index.ts`'s three `let`s + `Proxy` into one `Ref`-backed service —
  is real but is a behaviour-carrying rewrite of the daemon-recycle facade, and
  it does not become cheaper or safer by being done in the same commit as the
  wire migration. **Handed off** (§7).

What DID move off a module singleton in this commit: the five boot phases (§1),
and `servePadi`'s `errors` injection (gone with the oRPC error map — the handler
raises the declared class directly).

## 2. `servePadi.ts` — the Effect-native serve

### 2.1 One handler bridge, not thirty-five wrappers

`ProcedureImpl` is now ONE arm, `({input, ctx}) => Effect<O, E>` (S2 §5.4). Every
padi procedure crosses ONE seam:

```ts
function handle<A, E>(body: (signal: AbortSignal) => A | Promise<A>): Effect<A, E>
```

It routes a THROWN value onto the FAILURE channel when it is one of the eleven
DECLARED errors, and leaves everything else a DEFECT (D4). That rule is spelled
once rather than per member, because "which throw is declared" is exactly the
thing that rots when respelled thirty-five times. The predicate lives in
`errors.ts` as `isPadiDeclaredError`, derived from the same
`PADI_ERROR_CLASSES` array `PadiErrorSchema` is built from — so the union and the
runtime check cannot drift.

`isPadiDeclaredError` uses `instanceof`, deliberately: it runs at the SERVING
seam, where the value was constructed by padi's own in-process code moments
earlier. A value that CROSSED a wire is still narrowed structurally on `_tag`
(`reattachingDeltas`), where class identity genuinely may differ.

`handle`'s body receives the AbortSignal the CALL'S FIBER owns
(`Effect.tryPromise`'s signal). That is how `fs.filePreviewTag` still aborts a
multi-GB hash mid-read now that there is no `signal` handler option (D10/#18) —
an interrupted call is the Effect successor of a cancelled request.

### 2.2 The two source members

- `terminalAttach` — the snapshot-then-deltas generator became a module-level
  `attachFrames(id, resizeTo, signal)` wrapped in `streamFromAbortableSource`.
  The producer under it (the endpoint's `attach`, which opens a kaval
  subscription it must be TOLD to release) is genuinely AbortSignal-shaped, so it
  crosses at the framework's one sanctioned producer bridge rather than by
  threading a signal back through an option that no longer exists.
- `terminalExit` — same bridge, over `bus.subscribe(signal)`. `terminalNotFound`
  at subscribe time stays an UNDECLARED failure ⇒ a DEFECT, exactly as
  `errors.ts` documents; an `EventSpec` has no error channel to declare it on.

`activity` (`liveActivity.ts`) and the two fs/git pulse streams (`fsGitDeps.ts`)
took the same treatment: their `pollOnEvent` producers are the AbortSignal edge,
so `streamFromAbortableSource` wraps each per-subscription factory — which is
also what keeps the `seq` counter and the per-subscriber tracker private to one
subscriber.

### 2.3 The one narrowed cast

`session`'s store `set` writes `resumableIds` onto the value it was handed. A
decoded value is `readonly`, and rebuilding is NOT an option here: the cell bus
publishes the very object passed in (`applyAndPublish` publishes `next`, not a
post-set `get`), so a copy would carry the stamp while the wire pushed the
unstamped original. The write is cast to the ONE wire-only field this seam owns,
with the constraint recorded in place (PLAN rule 8).

## 3. `ptyHost/connect.ts` — the new wire, and three dead branches deleted

```ts
dialSocket(path) → stdioLink({ group: kavalDaemonGroup, read, write })
                 → { pty: ptyHostClientOver(dispatch),
                     control: buildSurfaceFace(kavalControlSurface, dispatch) }
```

ONE link over the WHOLE daemon group, then a typed face per sibling over its one
dispatch. `dispose()` is ASYNC and is the only thing that frees the protocol
fibers; `DaemonConnection.dispose` stays SYNCHRONOUS (the supervisor tears down
from paths that cannot await), so the release is FIRED and a rejection swallowed
at that one edge, visibly — the same shape `connectPadi` makes.

**Deleted, per padi-A §8.3/10:**

- `ptyHost/missingFrozenFragment.ts` (the module),
- `readKavalHandshake`'s `pre-fragment` arm and the whole `KavalHandshake`
  discriminated union (the frozen hello is now REQUIRED),
- `probePreFragmentKaval` + the redial `probeKavalForConvergence` wrapped it in
  (the probe IS `probeDaemonIdentity({capability:"not-drainable"})` now),
- `hostInventory.ts`'s `commit → null` tolerance arm.

The reason is D6, stated in the code: a kaval without the frozen route also
predates this PROTOCOL EPOCH, so its first frame is undecodable and a dial never
reaches route resolution — it is the supervisor's `unspeakable-protocol`
observation, not a fallback this module can take. `RunningKaval`'s
`buildCommit`/`contractVersion`/`terminalCount` are honestly nullable by the
schema's own design, so a cross-epoch peer still degrades gracefully.

`connect.test.ts` was rewritten on kaval's `contractSkew.test.ts` model: the
fakes take the LIVE `Rpc` out of `kavalDaemonGroup` (so a fake cannot drift from
the surface it imitates) and serve a NARROWER member set over a real unix socket
on the real ndjson wire. The retired pre-fragment cases are replaced by their
in-epoch successors:

| retired | replaced by |
|---|---|
| "projects honest unknown … when an old daemon lacks the fragment" | "REFUSES a peer that speaks this protocol but serves no frozen control core" |
| "rejects on the 10s version deadline after detecting a pre-fragment daemon" | "…when the frozen hello answers but system.version never does" |
| "pre-fragment fallback preserves the observed version and boot" | "refuses a speakable peer whose contract version this build cannot accept" (skew as DATA) |
| "pre-fragment daemon … is an older-build nudge" | — (the peer is unreachable this epoch) |
| "old daemon exiting between missing-fragment detection and the legacy redial ⇒ null" | — (there is no redial) |

## 4. `terminalEndpoint/local.ts`

`bridgeStream` takes a `Stream` and runs it with `Effect.runPromise(…, {signal})`
— the ONE Effect run edge in padi's tap layer. The surrounding domain
(`TerminalLifecycle.abort`, the port-nudge controller, the reconciler) stays
AbortController-shaped because it is not Effect code; interruption is what
actually closes the kaval subscription, and this is where the two vocabularies
meet. Its per-event fence, its abort-swallow and its `onError` contract are
verbatim, and `bridgeStream.test.ts` still pins the W12 STAYS-DEFINED-UNDER-
BLINDNESS invariant on both halves.

`resubscribeStream`'s `getStream` is still a THUNK, and that is now load-bearing
for a second reason: a kaval stream member is LAZY, so building one registers
nothing — the subscription exists only once `bridgeStream` RUNS it. The
eager-synchronous-throw guard (the forwarding facade calling `liveClient()`
before any Effect exists) is unchanged.

`attach()`'s `open()` bridges the caller's `signal` onto
`Stream.toAsyncIterable(...)`'s `iter.return()`, which interrupts the running
fiber — the unsubscribe. `reattachingDeltas` is untouched (it was already
iterator-shaped, and A converted its `PtyNotFound` catch).

DISK tolerance is preserved EXACTLY: `seedHandlelessTerminal` decodes with
`Schema.decodeUnknownResult` (zod `.safeParse` in Effect terms — a BRANCH), so
one malformed record is DROPPED with a warning and never throws. Same at the
inventory boundary (`inventoryReconcile`) and the orphan boundary (`reattach`).

## 5. `watch.ts`

`isDeadTransportError` moved to `@kolu/surface/errors` (S3 §8.9).
`unenrolledStreamCall` returns a `Stream` synchronously and takes only
`{ onRetry }` — so `disarmIdle` now rides S3's per-subscription retry TAP, which
fires once per RETRYABLE failure with per-attempt identity (#8). Same guarantee,
one layer down.

The three subscription sites go through ONE new local helper,
`iterateUntilAborted(stream, signal)`, which binds a member stream's teardown to
the `runWait` scaffold's AbortSignal. The scaffold is deliberately non-Effect, so
the translation happens once rather than at each site; without it an abandoned
wait would leave its subscription running for the life of the connection.

## 6. Everything else that moved

| file | change |
|---|---|
| `daemonBoot/controlCore.ts` | the two fragment-sibling handlers return `Effect` (`clockNow` via `Effect.sync`, so each call reads the clock afresh) |
| `activity/activity.ts` | `upsertMru` is genuinely pure now — it used to mutate the array the `activityFeed` cell still held, a write the surface never saw |
| `activity/finishQuiet.ts` | `withEndHook` → `withFeedHooks` (`Stream.onStart` + `Stream.ensuring`): "the feed is up" is now the moment the stream STARTS, which is the honest reading for a lazy member |
| `session/reconcile.ts`, `session/pairedDaemon.ts` | `live: readonly PtyHostListEntry[]` (a decoded wire array) |
| `session/sessionRestore.ts` | `.parse` → a module-scope `decodeSavedSession`; `optOutIds` readonly; the re-park OMITS `parentId` rather than spelling `undefined` (see below) |
| `terminals.ts` | `setTerminalParent` / `setTerminalIntent` DELETE the key when clearing |
| `terminalEndpoint/metadata.ts`, `local.ts` | `.parse` → module-scope `Schema.decodeUnknownSync` binders (these run on the ~150 ms observation firehose; `decodeUnknownSync` compiles the schema per application) |

### The `optionalKey` trap, found by the tests

`Schema.optionalKey(X)` accepts an ABSENT key and REJECTS a present `undefined`
one — where zod's `.optional()` accepted both. Three in-process writers spelled
`undefined`:

- `setTerminalParent` / `setTerminalIntent` writing `undefined` to clear. The
  authored record is re-decoded on every sleep/wake/park flip, so the explicit
  `undefined` blew up a LATER decode, not the write — an unhandled rejection.
- `settleRestoreRespawns`'s re-park building `{ ...record, parentId:
  r.parentIdMapped }` for a top-level record. `seedParkedTerminal`'s TOLERANT
  decode then dropped the record — silently losing the very re-park that path
  exists to perform (two `sessionRestore.test.ts` cases caught it).

All three now omit/delete the key. This is A's #17 note ("build these objects by
OMITTING the key") applied to the authored/saved records, and it is the one class
of behaviour bug the schema swap introduced.

## 7. Hand-off — `src/upgradeWindow/**` (the follow-up agent)

### 7.1 `tsc --noEmit`, verbatim

```
src/upgradeWindow/kavalFragmentAbsent.test.ts(35,7): error TS2353: Object literal may only specify known properties, and 'router' does not exist in type '{ socketPath: string; served: PtyHostServed; log?: Logger | undefined; }'.
src/upgradeWindow/kavalFragmentAbsent.test.ts(35,23): error TS2339: Property 'servedRouter' does not exist on type '{ readonly served: PtyHostServed; client: PtyHostClient; readonly boot: PtyHostBoot; terminalCount: () => number; done: Promise<void>; close(): Promise<...>; }'.
src/upgradeWindow/oldSessionFile.test.ts(99,44): error TS2339: Property 'parse' does not exist on type 'Struct<{ readonly terminals: $Array<Union<...>>; ... }>'.
src/upgradeWindow/oldSessionFile.test.ts(121,26): error TS2339: Property 'parse' does not exist on type 'Struct<{ readonly terminals: $Array<Union<...>>; ... }>'.
src/upgradeWindow/previousRelease.e2e.test.ts(36,8): error TS2305: Module '"@kolu/surface/links/unix-socket"' has no exported member 'UnixSocketConnection'.
src/upgradeWindow/previousRelease.e2e.test.ts(315,29): error TS2741: Property 'group' is missing in type '{ socketPath: string; }' but required in type 'UnixSocketLinkOptions'.
src/upgradeWindow/previousRelease.e2e.test.ts(318,14): error TS2339: Property 'client' does not exist on type 'WireLink'.
src/upgradeWindow/previousRelease.e2e.test.ts(371,41): error TS2558: Expected 0 type arguments, but got 1.
src/upgradeWindow/previousRelease.e2e.test.ts(375,20): error TS2339: Property 'client' does not exist on type 'WireLink'.
src/upgradeWindow/previousRelease.e2e.test.ts(390,47): error TS2558: Expected 0 type arguments, but got 1.
src/upgradeWindow/previousRelease.e2e.test.ts(524,39): error TS2741: Property 'group' is missing in type '{ socketPath: string; }' but required in type 'UnixSocketLinkOptions'.
src/upgradeWindow/previousRelease.e2e.test.ts(527,14): error TS2339: Property 'client' does not exist on type 'WireLink'.
src/upgradeWindow/previousRelease.e2e.test.ts(574,43): error TS2558: Expected 0 type arguments, but got 1.
src/upgradeWindow/previousRelease.e2e.test.ts(578,22): error TS2339: Property 'client' does not exist on type 'WireLink'.
src/upgradeWindow/previousRelease.e2e.test.ts(600,43): error TS2558: Expected 0 type arguments, but got 1.
src/upgradeWindow/previousRelease.e2e.test.ts(604,22): error TS2339: Property 'client' does not exist on type 'WireLink'.
src/upgradeWindow/socketContractMismatch.test.ts(21,9): error TS2740: Type 'ZodDefault<ZodObject<{}, $strip>>' is missing the following properties from type 'Codec<any, unknown, never, never>': "Encoded", "DecodingServices", "EncodingServices", "Rebuild", and 18 more.
src/upgradeWindow/socketContractMismatch.test.ts(22,9): error TS2740: Type 'ZodObject<{ contractVersion: ZodString; pid: ZodNumber; startedAt: ZodNumber; }, $strip>' is missing the following properties from type 'Codec<any, unknown, never, never>': "Encoded", "DecodingServices", "EncodingServices", "Rebuild", and 18 more.
src/upgradeWindow/socketContractMismatch.test.ts(32,67): error TS2339: Property 'router' does not exist on type '{ socketPath: string; group: RpcGroup<Any>; handlers: SurfaceHandlers; }'.
src/upgradeWindow/socketContractMismatch.test.ts(46,18): error TS2339: Property 'router' does not exist on type 'SurfaceRuntime<SurfaceSpec<never>>'.
src/upgradeWindow/socketContractMismatch.test.ts(62,7): error TS2353: Object literal may only specify known properties, and 'router' does not exist in type '{ socketPath: string; group: RpcGroup<Any>; handlers: SurfaceHandlers; }'.
```

### 7.2 The shapes to consume

- `servePtyHostOverUnixSocket({ socketPath, served: { group, handlers }, log? })`
  — `createInProcessPtyHost(...).servedRouter` is gone; use `.served`.
- `serveOverUnixSocket({ socketPath, group, handlers })` — `runtime.router` is
  gone; `implementSurfaces(...)` exposes `.group` + `.handlers`.
- `unixSocketLink({ group, socketPath })` → `Promise<WireLink>` with
  `{ dispatch, dispose }`. `UnixSocketConnection` and `.client` are gone; build a
  face with `ptyHostClientOver(link.dispatch)` /
  `buildSurfaceFace(kavalControlSurface, link.dispatch)`. `dispose()` is ASYNC
  and is the ONLY thing that frees the protocol fibers.
- `SavedSessionSchema.parse` → `Schema.decodeUnknownSync(SavedSessionSchema)`.
- `socketContractMismatch.test.ts` still imports zod; its hand-built contract
  becomes a `RpcGroup.make(<live Rpc>)` fake in the shape
  `ptyHost/connect.test.ts`'s `serveFake` now uses.
- `previousRelease.e2e.test.ts` is the D6/#1/#19 HARNESS rewrite: the
  previous-release readiness probes go transport-neutral (bare `net.connect()` or
  the gate file the test already reads), and the "compatible contract → adopt"
  arm is permanently the RECYCLE arm for this epoch. `PTY_HOST_CONTRACT_VERSION`
  is `"7.0"` (its `:541,:585` prose + assertions still say 6.0).
- `kavalFragmentAbsent.test.ts` describes a peer that CANNOT exist this epoch
  (see §3). It should become the in-epoch narrower-member-set case, or be retired
  with a ledger row — it is not ledger-frozen today.

### 7.3 Live unit failures (this commit's run), for the same agent

```
FAIL src/upgradeWindow/socketContractMismatch.test.ts [ collection error — zod contract ]
FAIL src/upgradeWindow/kavalFragmentAbsent.test.ts > yesterday kaval without the frozen fragment > becomes a build mismatch and the not-drainable policy nudges the human
FAIL src/upgradeWindow/oldSessionFile.test.ts > old session file under new padi (upgrade-window) > backfillSavedSession + parse RESTORES a known previous shape (named recovery)
FAIL src/upgradeWindow/previousRelease.e2e.test.ts > bidirectional previous-release daemon window > runs new-reads-old and old-reads-new against distinct stores
```

### 7.4 New disk artifacts (PLAN #11)

**None.** The Layer rewrite adds no lock, marker or socket: `surfacesLayer`'s
acquire/release only wraps the surface runtime (in memory), the gate layer writes
the SAME gate file `claimPidGate` always wrote, and the two
`writeStateRootManifest` calls are unchanged. So no
`upgradeWindow/sharedArtifacts.testlib.ts` entry is required by this commit —
verified rather than assumed, by re-reading every filesystem write on the boot
path.

## 8. Hand-off — the ptyHost endpoint service (the D9 residue)

`ptyHost/index.ts` still holds `let endpoint`, `let triggerRestart`,
`let infoPromise` and the forwarding `Proxy`. The idiomatic successor is ONE
`Context.Service` whose shape is `{ current: Ref<Connection | undefined>,
restart, info }`, with `ptyHostClient` becoming a thin face over a `Ref` read
instead of a `Proxy` over a `let`. It is a behaviour-carrying rewrite of the
daemon-recycle facade (`__setEndpointForTest`, `restartLocal.test.ts`,
`processTarget.test.ts` all bind to it), and it is orthogonal to the wire
migration — so it wants its own commit, not this one.

`ptyHost/processTarget.test.ts` also still hardcodes `contractVersion: "6.0"`
(padi-A §8.3/11); it is GREEN today because it never dials, but it will drift.

## 9. API-break list additions (drishti / odu follow-up)

Beyond A's list:

1. `runPadiDaemon` keeps its signature; `PadiDaemonOptions` is unchanged. The
   boot's internal phase tokens (`HeldGate`, `StoresReady`, `IdentityReady`,
   `SurfacesServed`, `EndpointBooted` as INTERFACES) are gone — they were never
   exported.
2. `bridgeStream(source: Stream, …)` and `resubscribeStream({ getStream: () =>
   Stream })` — both take Effect `Stream`s now.
3. `ptyHost/missingFrozenFragment.ts` and `isMissingFrozenFragment` are
   **deleted**.
4. `probeKavalForConvergence` is `probeDaemonIdentity({capability:
   "not-drainable"})` directly; every handshake failure propagates.
5. `errors.ts` gains `isPadiDeclaredError`.
6. `padiFsGitDeps(...).streams.*.source` and `createLiveActivitySource(...).source`
   take `(input)` and return `Stream`.
7. `restoreSession` / `importSession` take `optOutIds?: readonly string[]`;
   `reconcile(live, saved)` takes `readonly PtyHostListEntry[]`.

## 10. Nothing here invalidates a PLAN assumption

- **D9** is realised for the boot (the Layer graph, with the ordering proof and
  the scoped release) and explicitly NOT for the domain singletons, with the
  reason stated and the one worthwhile residue handed off (§1.2, §8).
- **D10/#18** lands at the two producer edges padi owns (the PTY taps and the
  attach/exit generators), both through the framework's ONE sanctioned bridge;
  the two `Effect.run*` sites are named for #25's allowlist.
- **D6** is followed literally: the pre-fragment tolerance is DELETED, not
  degraded, and the in-epoch skew mechanism is exercised by a new test rather
  than merely preserved.
- **D4** is realised at the serving seam by one bridge, with the declared/defect
  line drawn in one place.
- **#24** holds: the three ledger-frozen files keep their paths AND every `it()`
  title byte-identical (only internals moved — `sleepWake.test.ts`'s one `.parse`
  became a `decodeUnknownSync`, `session.test.ts`'s two schema `.parse`s
  likewise).
- **#11** is a no-op here, verified (§7.4).
- **Fault disposition** is unchanged and still distinct: padi is loud-not-fatal
  (`runtime.done.catch → log.error`, the process survives).
- No `package.json` `dependencies` block changed ⇒ standing rule 5 does not fire.
