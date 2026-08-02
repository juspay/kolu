# Effect 4 migration — plan of record

Campaign: convert kolu wholesale to Effect-TS 4.0 (beta), including oRPC → Effect RPC and
zod → Effect Schema. Done when `/ci` is full green on both platforms.

Recon dossiers (read these before implementing anything): `recon/effect4.md` (verified v4
API + traps), `recon/surface.md` (oRPC wire dossier), `recon/consumers.md` (non-framework
oRPC + DI inventory), `recon/zod.md` (schema inventory + byte-compat hit list),
`recon/ci.md` (CI map + FOD-hash procedure).

## Locked decisions (user-approved)

1. **Depth**: Node services, daemons, and the whole RPC/surface stack become Effect-native
   (Layer/Service, Schema, Effect RPC, Stream). SolidJS components keep plain async at the
   leaves, calling Effect-backed clients. The reactor (preact signals engine) and xterm
   rendering stay as-is.
2. **zod is fully replaced** by Effect Schema, everywhere. Zero zod deps at the end.
3. **Kolu only.** The drishti pair-PR gate (`.claude/rules/surface.md`) is explicitly
   deferred: flag it as required follow-up in the final PR body. Same for odu impact.
4. **One branch** (`effect`), staged commits, one PR, `/ci` green at the end.
5. **No escape hatches, no legacy code, no fallbacks** (user directive): fully idiomatic
   Effect 4; `Effect.runPromise`/`runFork` only at true process/UI edges; no compat shims,
   no leftover `@orpc/*` or `zod` imports, no dual paths. Exception that is NOT a fallback:
   the documented rolling-deploy tolerance defaults and tolerant-parse policies in
   `recon/zod.md` §hit-list are wire/disk *policy* and must be preserved.

## Target stack (verified 2026-08-02)

- `effect@4.0.0-beta.102`, `@effect/platform-node@4.0.0-beta.102`,
  `@effect/platform-browser@4.0.0-beta.102`, `@effect/vitest@4.0.0-beta.102` — **exact
  pins via pnpm catalog**, no `^`. All @effect/* must share one version.
- RPC: `effect/unstable/rpc` (`Rpc`, `RpcGroup`, `RpcClient`, `RpcServer`,
  `RpcSerialization`, `RpcMiddleware`, `RpcTest`). Schema: `import { Schema } from
  "effect"`. DI: `Context.Service` + `Layer` (NOT `ServiceMap` — renamed back in beta.44).
- Serialization: **ndjson** everywhere (`RpcSerialization.layerNdjson`).
- Docs of record: `node_modules/effect/src` JSDoc, `Effect-TS/effect@main` `MIGRATION.md`,
  `migration/*.md`, `LLMS.md`, `packages/effect/SCHEMA.md`. effect.website is still v3 —
  do not trust it. `Effect-TS/effect-smol` is a stale mirror — do not read it.

## Architecture decisions

**D1 — Tag encoding.** Rpc tags are slash-joined wire paths mirroring today's oRPC paths:
`surface/<member>/<verb>` (`surface/conn/get`, `surface/system/live`), procedures
`surface/<name>` (+ root procedures `server/info`, `hosts/viewer`, …). One flat
`RpcGroup` per served surface; sibling composition = tag prefixing (`RpcGroup.prefix`) or
key-scoped dispatch, replacing `composeSurfaceContracts`/`scopeSibling`.

**D2 — Client face.** `RpcClient.make(group, { flatten: true })` gives one `(tag,
payload, opts)` dispatch fn. The typed nested face (`client.surface.<member>.<verb>`) is
built by walking the spec — kolu owns the proxy now. Its TYPES derive from the spec
(`SurfaceTypes<S>`-style conditional types), not from RpcGroup inference (avoids TS2590).
`keyInjectingLink` (surface-map) becomes a dispatch wrapper: `(tag, input) → (tag,
{mapKey, input})`. `leafAt` becomes tag concatenation. `directLink` becomes an in-process
dispatcher that invokes handler effects directly — same face type, zero serialization,
`live` constant-true by construction (preserve that invariant).

**D3 — Streaming.** Every streaming member (cell `get`, collection `keys/get/deltas`,
streams, events) is `Rpc.make(tag, { stream: true, success, error })`; handlers return
`Stream`. Snapshot-then-deltas stays handler-enforced. `subscribeBeforeSnapshot` and the
one-microtask-per-yield ordering of `iterateUntilAborted` are load-bearing (pinned by
`kill.feature`) — preserve semantics when porting to Stream. The Solid bridge
(`createSubscription`) consumes the Stream via a scoped fiber at the UI edge; the
change-iff-fired law and "reconnect snapshot leads a fresh stream" invariant must hold.

**D4 — Errors.** New shared tagged-error vocabulary (Schema.TaggedErrorClass) in
`@kolu/surface`: `SurfaceTransportRetired`, `SurfaceStdioTransportClosed`,
`SurfaceRelayTransportLost`, `MapKeyNonCanonical`, `MapKeyUnknown`, `MapEntryFailed`, plus
per-surface declared procedure errors as Schema tagged errors. These replace every
`ORPCError` + `.code` string. They must survive serialize→deserialize→re-serialize across
the relay hop (shared schema union across tiers). `isDefinedError`/`safe` are replaced by
tagged-error narrowing helpers exported from `@kolu/surface/solid` (Promise-edge safe).
Undeclared defects stay defects (`Effect.die`) — fail fast.

**D5 — Transports.**
- Browser: `RpcClient.layerProtocolSocket({ retryTransientErrors: true })` +
  `Socket.layerWebSocket` + `layerWebSocketConstructorGlobal`. partysocket is replaced by
  Effect's socket reconnect + `RpcClient.ConnectionHooks`; `createLiveSignal`/heartbeat
  stay (they are transport-agnostic).
- Server HTTP+WS: hono + `WebSocketServer` in `server/src/index.ts` migrate to
  `effect/unstable/http` (`HttpRouter`, `NodeHttpServer`) with
  `RpcServer.layerHttp({ protocol: "websocket", path: "/rpc" })`; static assets, /api
  routes, preview routes, and the CSWSH origin gates become HttpRouter routes/middleware.
  Pino RPC logging → Effect middleware/Logger.
- Per-caller context (`viewerAddress`/`forwardedFor`, consumed only by `hosts/viewer`):
  an `RpcMiddleware` that provides a `CurrentViewer` service from the HTTP request.
- ssh/stdio: agent side `RpcServer.layerProtocolStdio`; parent side a `Socket` wrapped
  around the child's stdio, fed to `layerProtocolSocket`. The base64+newline
  `stdio-codec.ts` and the oRPC peer machinery are **deleted** (ndjson self-frames; JSON
  escapes newlines).
- unix socket: `NodeSocketServer.layer({ path })` / `NodeSocket.layerNet({ path })`.
- `frontDaemonOverStdio` stays a contract-blind byte splice (that property survives).

**D6 — Version skew / upgrade window.** The wire format breaks (oRPC peer → effect
ndjson). Bump `PTY_HOST_CONTRACT_VERSION` (kaval) and `PADI_SURFACE_VERSION`. The skew
path must treat protocol-level garbage (undecodable frames from an old peer) as skew →
recycle, not a crash: version probing against an old daemon cannot even parse, so the
probe's failure mode is the trigger. `ci::upgrade-window` and the surface-daemon
`upgradeWindow.*.testlib.ts` suites define the acceptance criteria — read them FIRST,
design to them (this is a known hard spot; do not hand-wave it).

**D7 — Pub/sub & ordering.** Kolu's own `Channel<T>`/`inMemoryPublisher` remain the
pub/sub (no @orpc publisher to port). padi's `MemoryPublisher` (from
`@orpc/experimental-publisher/memory`) is replaced by kolu's own existing publisher —
reuse the existing source of truth. Cross-channel microtask ordering is pinned by
`kill.feature`; whatever carries frames must preserve it.

**D8 — surface-mcp JSON Schema.** `z.toJSONSchema` glue is rewritten on
`Schema.toJsonSchemaDocument`/`toStandardJSONSchemaV1`. Snapshot tests update
deliberately; the invariants to keep: top-level `{type:"object"}`, `.default()` fields not
required, `$ref`/`$defs` dereferenced inline for MCP hosts.

**D9 — Services.** padi's ~15 module-level singletons (`lateBoundSurfaceCtx`, conf-store
setters, terminal registry Map, ptyHost endpoint lets, …) become `Context.Service`
classes with layers; `daemonMain`'s phase-token pipeline becomes a Layer graph;
entrypoints use `NodeRuntime.runMain`. Fault dispositions stay distinct and explicit:
kolu-server fatal (exit 1 on surface death), padi/kaval loud-not-fatal. Module-level
`export const t = implement(...)` disappears with the framework rewrite.

**D10 — Boundaries that stay non-Effect.** SolidJS component internals, the reactor
(`packages/surface/src/reactor.ts`, lint-pinned), xterm-kit rendering, vazhi's Ink tree.
They call Effect-backed clients through the surface client face; `runFork`/`runPromise`
appear only in: process `main()`s, the Solid bridge internals, UI event handlers, and
test harnesses. Every such edge is a real boundary, not a convenience hatch.

## Waves

- **W1 Foundations** — pnpm catalog + effect deps added everywhere they'll be needed
  (superset up front to minimize FOD-hash churn), lockfile, `nix/workspace.nix:178` hash
  refresh, typecheck stays green. Commit.
- **W2 Framework core** — rewrite `surface` (define/server/client/links/peer),
  `surface-map`, `surface-remote`, `surface-daemon(+supervisor)`, `surface-app`,
  `surface-mcp`, + surface examples, + their tests. Gate: framework packages typecheck +
  unit green in isolation.
- **W3 App schemas & contracts** — zod→Schema in common, terminal-vocab, integrations/*,
  transcript-core, kaval ptyHostSurface, padi vocab/surface/chromeVocab, server state,
  kolu-mcp; contract composition → RpcGroup merges. (Repo-wide typecheck may be red until
  W4 — the gate is at W4.)
- **W4 Transports & daemons** — server/index.ts on effect http, router.ts, surface.ts
  widening seam; padi daemonMain Layers + singleton→Service; kaval daemon; dial paths;
  upgrade-window story (D6). Gate: repo-wide `pnpm typecheck` green, `just test-unit`
  green, dev-smoke passes locally.
- **W5 Client & leaves** — client wire.ts, error-narrowing sites (client, xterm-kit),
  tuis/cli adjustments. Gate: unit + dev-smoke.
- **W6 Purge & polish** — remove every `zod`/`@orpc/*` dep, second FOD refresh, biome
  clean (`--error-on-warnings`), `just fmt`, examples + website surface reference MDX
  (`.claude/rules/surface-reference.md`), changelog entry, atlas-sync.
- **W7 CI to green** — `just test-quick` on touched features locally, then odu
  two-platform runs (`mcp__odu__run platforms=["x86_64-linux","aarch64-darwin"]`) looped
  to full green; e2e evidence comment; PR with drishti/odu follow-up flags.

## Standing rules for every implementation agent

1. Read the relevant recon dossier section before touching a package.
2. v4 API doubts → read `node_modules/effect/src/*.ts` JSDoc in this repo (after W1) or
   `Effect-TS/effect@main` migration docs. Never trust v3 memory: `Either→Result`,
   `catchAll→catch`, `fork→forkChild`, `Effect.async→Effect.callback`,
   `Context.Service<Self,Shape>()(id)` argument order, no auto `.Default` layer.
3. Byte-compat hit list (`recon/zod.md` end) is inviolable: disk formats, exported
   session JSON, the fold envelope (`void member ⇒ no input key`), MCP JSON Schema
   contract. Write a round-trip test when converting any schema on that list.
4. Never rename/delete an e2e scenario (e2e-governance reds). `ci/mod.just` DAG is
   unit-test-pinned — don't edit it.
5. After ANY pnpm-lock.yaml change: refresh `nix/workspace.nix:178` per `recon/ci.md` §2.
6. Biome runs `--error-on-warnings`: no import cycles, no floating promises, exhaustive
   `_tag` switches. A scoped biome override needs a written reason.
7. `just fmt` before every commit batch. Conventional commits.
8. No `as any` unless the deleted oRPC code had it for the same structural reason and no
   typed alternative exists — then a comment stating the constraint.
