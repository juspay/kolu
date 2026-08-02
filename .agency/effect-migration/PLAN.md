# Effect 4 migration — plan of record (v2, post-review)

Campaign: convert kolu wholesale to Effect-TS 4.0 (beta), including oRPC → Effect RPC and
zod → Effect Schema. Done when `/ci` is full green on both platforms.

Recon dossiers (read before implementing anything): `recon/effect4.md` (verified v4 API +
traps), `recon/surface.md` (oRPC wire dossier), `recon/consumers.md` (non-framework oRPC +
DI inventory), `recon/zod.md` (schema inventory + byte-compat hit list), `recon/ci.md`
(CI map + FOD-hash procedure). `review-findings.md` holds the 26 adversarial review
findings this v2 integrates — cited below as (#N).

## Locked decisions (user-approved)

1. **Depth**: Node services, daemons, and the whole RPC/surface stack become Effect-native
   (Layer/Service, Schema, Effect RPC, Stream). SolidJS components keep plain async at the
   leaves, calling Effect-backed clients. The reactor (preact signals engine) and xterm
   rendering stay as-is.
2. **zod is fully replaced** by Effect Schema, everywhere. Zero zod deps at the end.
3. **Kolu only.** The drishti pair-PR gate (`.claude/rules/surface.md`) is explicitly
   deferred: flag it as required follow-up in the final PR body, including every public
   API break called out below (client face, error vocabulary, AbortSignal signatures,
   dependency pinning). Same for odu.
4. **One branch** (`effect`), staged commits, one PR, `/ci` green at the end.
5. **No escape hatches, no legacy code, no fallbacks** (user directive): fully idiomatic
   Effect 4; `Effect.run*` only at true process/UI edges; no compat shims, no leftover
   `@orpc/*` or `zod` imports, no dual paths. NOT fallbacks (preserved as policy): the
   documented rolling-deploy tolerance defaults and tolerant-parse policies in
   `recon/zod.md` §hit-list, and the daemons' distinct fault dispositions.

## Target stack (verified 2026-08-02)

- `effect@4.0.0-beta.102`, `@effect/platform-node@…`, `@effect/platform-browser@…`,
  `@effect/vitest@…` — **exact pins, all @effect/* on one version.**
- Pinning mechanism (#22): the seven `@kolu/surface*` package.json files spell the
  **literal exact version** (they are vendored by pinned consumers drishti/odu, where
  `catalog:` would not resolve); kolu-private packages may use `catalog:`; root
  `pnpm.overrides` additionally pins `effect` and `@effect/*` so one version wins
  everywhere.
- RPC: `effect/unstable/rpc`. Schema: `import { Schema } from "effect"`. DI:
  `Context.Service` + `Layer` (NOT `ServiceMap` — renamed back in beta.44).
- Serialization: **ndjson** everywhere (`RpcSerialization.layerNdjson`).
- Docs of record: `node_modules/effect/src` JSDoc, `Effect-TS/effect@main` `MIGRATION.md`
  + `migration/*.md` + `LLMS.md` + `packages/effect/SCHEMA.md`. effect.website is still
  v3; `Effect-TS/effect-smol` is a stale mirror — trust neither.
- **Compiler gate (#20)**: the repo typechecks with `typescript@7.0.2` (tsgo-based). A
  pre-W2 spike must prove the four hardest shapes (dynamic RpcGroup w/ streaming member,
  `Schema.TaggedErrorClass`, `Context.Service`+Layer, the D2 conditional-type face)
  compile under the repo's own tsc. Written fallback if it fails: drop the workspace to
  `typescript@5.9.3` (already in the lockfile) and record the cost.

## Architecture decisions

**D1 — Tag encoding & group assembly.** Rpc tags are slash-joined wire paths
(`surface/<member>/<verb>`, `surface/system/live`, root procedures `server/info`, …).
One flat `RpcGroup` per served surface. (#16) `RpcGroup.make`/`merge` are last-writer-wins
`Map.set` with zero collision detection, and a dynamically-assembled group has no
type-level safety — so: the spec walk carries `defineSurface`'s `claim()` duplicate-throw
forward itself (flat tag namespace means `member="conn/get"` collides with
`member="conn", verb="get"` — detect it); every `make`/`merge`/`prefix` is followed by an
assertion that `group.requests.size` matches the expected tag count; sibling composition
uses **`prefix`/per-sibling tag minting, never bare `merge`** (merge collides the three
reserved `system/*` tags). The deleted `StandardRPCMatcher` path tests are replaced by
tests asserting the exact `group.requests` key set.

**D2 — Client face.** `RpcClient.make(group, { flatten: true })` gives one `(tag,
payload, opts)` dispatch fn; the typed nested face (`client.surface.<member>.<verb>`) is
built by walking the spec, typed from the spec (conditional types), not from RpcGroup
inference (TS2590 + `Rpc.Any` gives `never` payloads, #16). (#13) Effect's generated
client types payloads on the make-in/Type side, inverting today's `z.input` behaviour —
so the face exposes the **Encoded side** for inputs and **encodes payloads itself**
(Schema.encode) before handing them to the flat dispatch fn; `boundProcedure.test-d.ts`
is ported (not deleted) as the type-level gate. `keyInjectingLink` → dispatch wrapper
`(tag, input) → (tag, {mapKey, input})`. `leafAt` → tag concatenation. `directLink` → an
in-process dispatcher invoking handler effects directly — same face type, zero
serialization, `live` constant-true by construction (preserve that invariant).

**D3 — Streaming & the reconnect contract.** Streaming members are `Rpc.make(tag,
{ stream: true })`; handlers return `Stream`; snapshot-then-deltas stays
handler-enforced. (#12 — verified) `retryTransientErrors` does NOT resurrect in-flight
calls: an established-socket close fails every entry with `RpcClientError` and nothing
re-issues them. Therefore **the surface client owns a per-subscription retry fence inside
each Stream** before it reaches the Solid bridge: `Stream.retry` on a schedule (spaced
1000ms — `lastEventRetry` has no Effect counterpart, record that), gated on a direct port
of `shouldNotRetryORPCError` (retry `RpcClientError` + `SurfaceRelayTransportLost`
forever; never retry a declared D4 error). (#8) The per-call `onRetry` hook is
per-subscription and supersession-aware (Terminal.tsx `resetIfLive`, watch.ts
`disarmIdle`) — it survives as a tap inside that same per-stream retry, preserving
per-attempt identity. Acceptance test (W2): a mid-stream socket drop yields exactly one
fresh snapshot, no error reaching `createSubscription`.
(#7) kill.feature pins TWO opposing ordering invariants — restate them
implementation-independently and unit-test both in W2: (1) when two channels publish in
the same tick, client delivery order equals publish order (today: one microtask per yield
in `iterateUntilAborted`); (2) a single-yield-then-complete event source delivers its
value before end-of-stream (today: event handlers add NO wrapper layer). Effect's fiber
scheduler gives no microtask-level control — these tests, not the mechanism, are the
spec.

**D4 — Errors.** Shared tagged-error vocabulary (`Schema.TaggedErrorClass`) in
`@kolu/surface`: `SurfaceTransportRetired`, `SurfaceStdioTransportClosed`,
`SurfaceRelayTransportLost`, `MapKeyNonCanonical`, `MapKeyUnknown`, `MapEntryFailed`,
plus per-surface declared procedure errors as Schema tagged errors. Replaces every
`ORPCError`+code; must survive serialize→deserialize→re-serialize across the relay hop.
`isDefinedError`/`safe` → tagged-error narrowing helpers (Promise-edge safe) from
`@kolu/surface/solid`. Undeclared defects stay defects (`Effect.die`).

**D5 — Transports.**
- Browser leg: `RpcClient.layerProtocolSocket` over `Socket.layerWebSocket` +
  `layerWebSocketConstructorGlobal`, replacing partysocket. THREE review-mandated seams:
  (#5) a **terminal-close classifier** — close code `STALE_PROCESS_CLOSE_CODE` (4001)
  stops the retry schedule and fails all in-flight+future calls with
  `SurfaceTransportRetired`; test: a 4001 close ⇒ exactly one close, zero re-dials.
  (#6c) the connect URL is a **thunk re-evaluated on every re-dial** (pid echo).
  (#4) `createLiveSignal`'s half-open watchdog needs open/close observability and an
  imperative force-reconnect; Effect's socket layer exposes neither to callers — the
  surface owns a thin `WatchableSocket`-equivalent around the socket layer (status events
  + a recovery action that interrupts the protocol fiber to force a re-dial), and the
  `LIVE_SIGNAL_HANDLES` brand + `surfaceClient`'s refusal of bare links are re-derived on
  it. Budgeted in W2, not "stays as-is".
- Server HTTP+WS: `effect/unstable/http` (`HttpRouter`, `NodeHttpServer`) replacing hono;
  static assets, /api routes, preview routes, CSWSH origin gates become router
  routes/middleware; pino RPC logging → Effect middleware/Logger. (#6, #15) Do NOT use
  the `layerHttp`/`layerProtocolWebsocket` turnkey path: hand-wire
  `RpcServer.toHttpEffectWebsocket` behind a custom upgrade route so that (a) the
  stale-tab gate (`acceptSurfaceSocket`: gate → enrol → dispatch order, kolu#1231) and
  the ws ping/terminate reaper survive in front of RPC dispatch, and (b)
  `HttpServerRequest.remoteAddress` is injected as a synthetic header before `onSocket`
  so the `CurrentViewer` RpcMiddleware can provide `viewerAddress` (headers are all the
  websocket protocol forwards).
- ssh/stdio: agent side `RpcServer.layerProtocolStdio`; parent side a `Socket` around
  child stdio into `layerProtocolSocket`. unix socket: `NodeSocketServer.layer({path})` /
  `NodeSocket.layerNet({path})`. The oRPC peer machinery + base64 codec are deleted.
  (#10) `frontDaemonOverStdio` stays a contract-blind byte splice ONLY if stdio-leg and
  socket-leg framing are byte-identical — W2 gate: a round-trip test that bytes from the
  stdio protocol layer are accepted verbatim by the socket layer and vice versa; also
  confirm no surface member carries binary payloads under ndjson (base64 existed for
  binary safety, not just newlines).

**D6 — Version skew / upgrade window (hard flag day).** The wire break is a **declared
flag day** for the daemon protocol epoch; no dual-protocol serving, no legacy listener.
Consequences, from the review's blockers:
- (#2) `controlCore`'s "this channel never versions" doctrine is re-scoped to "never
  versions *within a protocol epoch*": the epoch break is documented in
  `controlCore.ts`'s header and the invariants docs in the SAME commit that changes the
  wire; the frozen-hello contract holds again from this epoch forward.
- (#3) Supervisor convergence gains a THIRD, narrowly-typed observation —
  `unspeakable-protocol` — raised ONLY by an explicit first-frame decode failure from a
  peer whose gate file we own and whose pid we verified (never widening `probe-failed`,
  which keeps protecting foreign socket-squatters from SIGTERM; `bindResult.ts`'s
  "never catch-to-null" regression note stays honored). Dispositions: kaval → recycle;
  padi → **refuse** with an explicit operator-facing message (its
  `drain-newer-else-refuse` cannot drain over an unspeakable wire — degenerates to
  refuse, stated in code).
- (#9) The classification happens at transport/first-frame decode, NOT by waiting out
  the 30s hello deadline; `awaitHelloGone` gains an explicit bound for the unspeakable
  case. Boot must still converge inside the e2e's 90s budget.
- (#1, #19) `previousRelease.e2e.test.ts` is partly a HARNESS that must be rewritten in
  W4 (not discovered at W7): the previous-release readiness probes become
  transport-neutral (bare `net.connect()` or the gate file the test already reads); the
  "compatible contract → adopt" arm is re-stated as permanently the recycle arm for this
  epoch; version-tag/store-inequality guards kept; `oldReadsNew`'s reverse arm
  (current-kaval dial) is unaffected. `KOLU_UPGRADE_WINDOW_REQUIRE=1` stays.
- (#11) Any new daemon-lifecycle disk artifact (locks/sockets/markers from the Layer
  rewrite) must be registered in `sharedArtifacts.testlib.ts` in the same commit.
- Version constants (`PTY_HOST_CONTRACT_VERSION`, `PADI_SURFACE_VERSION`) still bump, as
  the in-epoch skew mechanism for future upgrades.

**D7 — Pub/sub & ordering.** Kolu's own `Channel<T>`/`inMemoryPublisher` remain; padi's
oRPC `MemoryPublisher` is replaced by kolu's own publisher (reuse the existing source of
truth). The ordering spec is D3's two invariants + their W2 unit tests.

**D8 — surface-mcp JSON Schema.** Rewrite on `Schema.toJsonSchemaDocument`. (#14) Five
measured divergences to handle explicitly: (1) Effect emits `additionalProperties:false`
on every object — keep tool inputs open; (2) `Schema.Number` emits an
Infinity/NaN-tolerant `anyOf` — use `Schema.Finite`/`Schema.Int` for MCP-facing numerics;
(3) `Void`/`Undefined` → `{"type":"null"}` — special-case to `emptyObjectSchema()`
before `enforceObject` so no-arg tools don't demand `value:null`; (4) `default` keyword
is dropped — re-emit from the default annotation; (5) `$defs` live on
`Document.definitions` — rewrite `collectDefs` accordingly. `jsonschema.test.ts`
assertions stay as the gate; do not re-snapshot them away.

**D9 — Services.** padi's ~15 module-level singletons (`lateBoundSurfaceCtx`, conf-store
setters, terminal registry Map, ptyHost endpoint lets, …) become `Context.Service`
classes with layers; `daemonMain`'s phase-token pipeline becomes a Layer graph;
entrypoints use `NodeRuntime.runMain`. Fault dispositions stay distinct: kolu-server
fatal, padi/kaval loud-not-fatal. `export const t = implement(...)` disappears with the
framework rewrite.

**D10 — Boundaries & the AbortSignal seam.** SolidJS component internals, the reactor,
xterm-kit rendering, vazhi stay non-Effect; they call Effect-backed clients through the
face. (#18) Effect RPC has NO `signal` anywhere — the boundary decision: member sources
(`StreamSpec`/`EventSpec.source`, cell/collection deps) change signature to return
`Stream`/`Effect` (interruption-native), with `Stream.callback` bridging
AbortSignal-based producers (PTY, node APIs) at the producer edge;
`isAbortReason`/`iterateUntilAborted`/`superviseTerminalSource` are redesigned in Effect
terms (their AbortSignal shapes are a public API break — goes on the drishti/odu
follow-up list). (#25) The `Effect.run*` edge discipline is enforced by construction, not
review: a W6 unit test enumerates sanctioned `runFork`/`runPromise`/`runSync` call sites
(same shape as the reactor's `noRestrictedImports` pin) — biome's Promise rules cannot
see un-run Effects.

## Waves

- **W1 Foundations** — DONE (commit 51b2e21): catalog + effect deps + FOD hash.
- **W1.5 Hardening (new, from review)** — DONE. (#21) both dep holes closed
  (`effect` added to surface-daemon-supervisor, `@effect/platform-browser` added to
  surface); (#22) literal `4.0.0-beta.102` in all seven `@kolu/surface*` manifests
  (`catalog:` kept only for kolu-private members, which are workspace-local) + root
  `pnpm.overrides` for `effect`/`@effect/platform-node`/`@effect/platform-browser`/
  `@effect/vitest`; canary imports dropped into all 35 packages that declare an
  effect-family dep — `pnpm typecheck` green and padi `buildId.closure.test.ts` green
  — then deleted. Lockfile moved; the FOD hash did **not** (specifier-only change,
  identical resolved tarballs), verified with the two-build `--rebuild` sequence.
  - **(#20) TS 7.0.2 spike: PASS — W2 is unblocked on the compiler.** A throwaway
    `packages/surface/src/__ts7_spike.ts` exercised, simultaneously and under the
    repo's committed tsconfig chain: an `RpcGroup.make` of three `Rpc.make` members
    including one `{ stream: true }`; `Schema.TaggedErrorClass`; a `Schema.Struct`
    with `Schema.optionalKey` + `Schema.withDecodingDefaultKey`; a
    `Context.Service` class with a `Layer.effect` static layer; `RpcGroup.toLayer`
    handler inference; a `SurfaceTypes<S>`-shaped mapped+conditional face over a
    `{ cells: { … schema } }` spec, instantiated and called; `RpcClient.make(group,
    { flatten: true })`; and `RpcTest.makeClient` in both flat and object form.
    Zero errors, **no TS2590**. Wall clock 1.31–1.34 s with the spike vs 1.25–1.33 s
    without — inside the noise. A seven-case negative battery confirmed tsgo really
    resolves the conditional types (wrong tag, wrong success type, unknown face
    member, bad handler return all errored with precise messages), so the pass is
    not a silent collapse to `any`. **No fallback to typescript@5.9.3 is needed.**
- **W2 Framework core** — surface, surface-map, surface-remote, surface-daemon(+
  supervisor), surface-app, surface-mcp, + surface examples + tests. Explicit
  deliverables beyond the rewrite: D3's two ordering unit tests; D3's
  reconnect-fresh-snapshot test; D5's 4001-terminal-close test; D5/#10 byte-splice
  round-trip test; ported `boundProcedure.test-d.ts`; D1's `group.requests` key-set
  tests; (#26) the `define.ts` biome `noExplicitAny` override re-scoped or deleted with
  a rewritten reason. Gate: framework packages typecheck + unit green + `biome lint
  --error-on-warnings packages/surface*`.
- **W3 App schemas & contracts** — zod→Schema in common, terminal-vocab, integrations/*,
  transcript-core, kaval ptyHostSurface, padi vocab/surface, server state, kolu-mcp;
  contract composition → RpcGroup prefixing. (#17) Mapping table is LAW: zod
  `.optional()` → `Schema.optionalKey` for every WIRE/DISK field (never
  `Schema.optional`, which round-trips explicit `undefined` through `null`); zod
  `.default(v)` → `Schema.withDecodingDefaultKey` for wire fields (stricter than zod on
  in-memory `undefined` — any in-process `.parse` caller like the migration ladder or
  `backfillSavedSession` strips `undefined` keys first); every hit-list format gets a
  **byte-level fixture test asserting the encoded JSON string**, not just
  decode-equality.
- **W4 Transports & daemons** — server/index.ts on effect http (hand-wired ws seam per
  D5), router/surface widening seam, padi daemonMain Layers + singleton→Service, kaval
  daemon, dial paths, the WHOLE D6 story including the harness rewrite. (#24) The file
  paths AND test titles of `padi/src/session/reconcile.test.ts`, `session/session.test.ts`,
  `terminalEndpoint/sleepWake.test.ts` are frozen by `coverage-ledger.yaml` — moving or
  renaming one requires a ledger row in the same commit; W4 pre-flight: `just --no-deps
  test-e2e-governance`. Gate: repo-wide typecheck green, `just test-unit` green,
  dev-smoke local.
- **W5 Client & leaves** — client wire.ts, error-narrowing sites (client, xterm-kit),
  tuis/cli. Gate: unit + dev-smoke.
- **W6 Purge & polish** — remove every `zod`/`@orpc/*` dep, second FOD refresh, (#23)
  `nix eval .#padi.drvPath` + `nix eval .#kaval.drvPath` (stableLeaves closure asserts),
  the `Effect.run*` allowlist test (#25), biome clean, `just fmt`, examples + website
  surface reference MDX, changelog, atlas-sync.
- **W7 CI to green** — `just test-quick` on touched features locally, then odu
  two-platform runs looped to full green; e2e evidence; PR with the drishti/odu
  follow-up list (API breaks from D2/D4/D10, pinning from #22).

## Standing rules for every implementation agent

1. Read the relevant recon dossier section (and `review-findings.md` for your area)
   before touching a package.
2. v4 API doubts → read `node_modules/effect/src/*.ts` JSDoc in this repo or
   `Effect-TS/effect@main` migration docs. Never trust v3 memory: `Either→Result`,
   `catchAll→catch`, `fork→forkChild`, `Effect.async→Effect.callback`,
   `Context.Service<Self,Shape>()(id)` argument order, no auto `.Default` layer.
3. Byte-compat hit list (`recon/zod.md` end) is inviolable, with the #17 mapping table
   above. Byte-level fixture tests are mandatory for hit-list formats.
4. Never rename/delete an e2e scenario (e2e-governance). The three ledger-frozen padi
   unit test files/titles (#24) need ledger rows to move. `ci/mod.just` DAG is
   unit-test-pinned — don't edit it.
5. After ANY change to a package.json `dependencies` block: refresh
   `nix/workspace.nix:178` per `recon/ci.md` §2 AND re-check `default.nix` stableLeaves
   for both daemons (#23) — a removed edge that drops a leaf from a daemon's closure is
   a hard nix eval error across every nix-building CI node.
6. Biome runs `--error-on-warnings`: no import cycles, exhaustive `_tag` switches. Do
   not claim Promise-lint coverage for Effect values (#25).
7. `just fmt` before every commit batch. Conventional commits.
8. No `as any` unless the deleted oRPC code had it for the same structural reason and no
   typed alternative exists — then a comment stating the constraint.
