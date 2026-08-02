> **Verification method**: every claim below was checked against the npm registry, the `Effect-TS/effect` repo at `main` (pushed 2026-08-02), or by installing `effect@beta` (= `4.0.0-beta.102`) and **compiling + running** the code sketches. Sketches live in `/tmp/claude-1000/-home-srid-code-kolu--worktrees-effect/1013e03f-716b-468a-b611-907920195964/scratchpad/e4/src/` (`contract.ts`, `server.ts`, `client.ts`, `pubsub-server.ts`, `run-client.ts`, `middleware.ts`, `zod.ts`) — all `tsc --strict --exactOptionalPropertyTypes` clean, and the server/client pair was executed successfully over a real WebSocket.

---

# 1. Packages & versions (as of 2026-08-02)

`effect` dist-tags: `latest = 3.22.1` (published 2026-07-30), **`beta = 4.0.0-beta.102`** (published 2026-07-26). 100 v4 betas exist; `beta.0` was 2026-02-18. `next` is **not** a tag — the tag is `beta`.

```bash
pnpm add effect@beta                    # 4.0.0-beta.102
pnpm add @effect/platform-node@beta     # 4.0.0-beta.102  (server)
pnpm add @effect/platform-browser@beta  # 4.0.0-beta.102  (browser)
pnpm add -D @effect/vitest@beta         # 4.0.0-beta.102
```

**All ecosystem packages share ONE version number** and release together. Pin all of them to the identical `4.0.0-beta.N`.

| Package | v4 status |
|---|---|
| `effect` | `beta` = 4.0.0-beta.102 |
| `@effect/platform-node` / `-browser` / `-bun` | `beta` = 4.0.0-beta.102 |
| `@effect/sql-pg`, `@effect/sql-sqlite-node`, … | `beta` = 4.0.0-beta.102 |
| `@effect/ai-openai`, `@effect/ai-anthropic` | `beta` = 4.0.0-beta.102 |
| `@effect/opentelemetry` | `beta` = 4.0.0-beta.102 |
| `@effect/atom-solid`, `@effect/atom-react` | **`latest` = 4.0.0-beta.102** (note: `beta` tag on these is stale at `4.0.0-beta.0`; use the exact version) |
| `@effect/vitest` | `beta` = 4.0.0-beta.102 |
| **`@effect/rpc`** | ❌ **no v4** — merged into `effect/unstable/rpc` |
| **`@effect/platform`** | ❌ **no v4** — split into `effect/*` + `effect/unstable/http` \| `socket` \| `workers` |
| **`@effect/cluster`**, **`@effect/experimental`**, **`@effect/cli`**, **`@effect/ai`**, **`@effect/schema`** | ❌ **no v4** — all merged into `effect` |
| `@effect/typeclass`, `@effect/printer`, `effect-http`, `@effect/eslint-plugin` | ❌ **no v4 at all** |
| `@effect/language-service` | single track, `0.87.1` (2026-07-23), no v4 tag; version-agnostic TS plugin. Note its README: for TS 7.0+ use `@effect/tsgo` instead. |

Runtime facts from the installed tarball: `"type": "module"` — **ESM-only, no CJS build** (v3 shipped dual). `"sideEffects": []`. 424 `.js` files, 30 MB unpacked dist. Runtime deps: `ini, toml, uuid, yaml, msgpackr, fast-check, multipasta, find-my-way-ts, kubernetes-types, @standard-schema/spec`.

---

# 2. Import paths in v4

## Top-level `effect/*` (stable, strict semver)
`Effect, Layer, Context, Schema, SchemaAST, SchemaIssue, SchemaParser, SchemaTransformation, SchemaGetter, Stream, Sink, Channel, Queue, PubSub, Ref, SubscriptionRef, Fiber, Scope, Cause, Exit, Option, Result, Data, Duration, DateTime, Config, ConfigProvider, Logger, Metric, Tracer, ManagedRuntime, References, RequestResolver, Request, Filter, Latch, Semaphore, Optic, Newtype, Graph, JsonSchema, JsonPatch, FileSystem, Path, Terminal, PlatformError, Stdio, LayerMap, Tx*` (Software Transactional Memory: `TxRef`, `TxHashMap`, …).

### ⚠️ `Context`, not `ServiceMap`
The v4 module **was** called `ServiceMap` and was **renamed back to `Context` in `4.0.0-beta.44`** (2026-04-09, PR effect-smol#1961). Every blog post, LLM memory, and the stale `Effect-TS/effect-smol` mirror still says `ServiceMap` — **it does not exist in beta.102**. Verified: `node_modules/effect/dist/Context.js` exports `Reference Service ServiceTypeId add addOrOmit empty get getOption getOrElse getOrUndefined getReferenceUnsafe getUnsafe isContext isKey isReference make makeUnsafe merge mergeAll mutate omit pick`. There is no `ServiceMap.d.ts`.

## `effect/testing/*`
`effect/testing/FastCheck`, `effect/testing/TestClock`, `effect/testing/TestConsole`, `effect/testing/TestSchema`.

## `effect/unstable/*` — **breaking changes allowed in minor releases**
20 subpath exports (from `package.json#exports`):
`ai, cli, cluster, devtools, encoding, eventlog, http, httpapi, observability, persistence, process, reactivity, rpc, schema, socket, sql, workflow, workers` (+ `testing`). Each is a barrel; individual modules are also importable via the `./*` wildcard.

| Concern | v4 import |
|---|---|
| Schema | `import { Schema } from "effect"` (top-level, **not** `@effect/schema`, **not** unstable) |
| Service tag / DI | `import { Context, Layer } from "effect"` |
| RPC | `effect/unstable/rpc` → `{ Rpc, RpcGroup, RpcClient, RpcServer, RpcSerialization, RpcMiddleware, RpcSchema, RpcMessage, RpcClientError, RpcTest, RpcWorker }`; deep: `effect/unstable/rpc/RpcServer` |
| HTTP server | `effect/unstable/http` → `HttpRouter, HttpServer, HttpServerRequest/Response, HttpMiddleware, HttpPlatform, Etag, Headers, Cookies, Multipart, Url, UrlParams, HttpStaticServer, FindMyWay` |
| HTTP client | `effect/unstable/http/HttpClient`, `.../FetchHttpClient`; node: `@effect/platform-node/NodeHttpClient`; browser XHR: `@effect/platform-browser/BrowserHttpClient` |
| WebSocket (shared) | `effect/unstable/socket/Socket` → `Socket, WebSocket, WebSocketConstructor, layerWebSocket, layerWebSocketConstructorGlobal, makeWebSocket, fromWebSocket, makeWebSocketChannel, toChannel*, SocketError` |
| WebSocket server | `effect/unstable/socket/SocketServer` (+ `@effect/platform-node/NodeSocketServer` → `layer` (TCP), `layerWebSocket` (standalone ws)) |
| WebSocket browser client | `@effect/platform-browser/BrowserSocket` → `layerWebSocket(url)`, `layerWebSocketConstructor`; or core `Socket.layerWebSocket(url)` + `Socket.layerWebSocketConstructorGlobal` |
| WebSocket node client | `@effect/platform-node/NodeSocket` → `layerWebSocket`, `layerWebSocketConstructor`, `layerWebSocketConstructorWS` (the `ws` package), `layerNet` (TCP) |
| Streaming RPC | `Rpc.make(tag, { stream: true })` → wraps success in `RpcSchema.Stream` |
| Server→client push | streaming RPC handler returning `Stream.fromPubSub(hub)` (PubSub is top-level `effect`) |
| Workers / MessagePort | `effect/unstable/workers/{Worker, WorkerRunner, Transferable, WorkerError}` + `RpcClient.layerProtocolWorker` / `RpcServer.layerProtocolWorkerRunner` |
| Reactive atoms | `effect/unstable/reactivity/{Atom, AtomRegistry, AtomRef, AtomRpc, AtomHttpApi, AsyncResult, Hydration, Reactivity}` |
| HttpApi (OpenAPI-style) | `effect/unstable/httpapi` |
| MsgPack / NDJSON / SSE codecs | `effect/unstable/encoding/{Msgpack, Ndjson, Sse}` |

**Import map** (full list at `migration/v3-to-v4.md` §Import Map): `@effect/rpc/Rpc → effect/unstable/rpc/Rpc`, `@effect/platform/Socket → effect/unstable/socket/Socket`, `@effect/platform/HttpRouter → effect/unstable/http/HttpRouter`, `@effect/platform/FileSystem → effect/FileSystem`, `@effect/platform/Path → effect/Path`, `@effect/platform/Error → effect/PlatformError`, `@effect/platform/Worker → effect/unstable/workers/Worker`, `@effect/sql/Model → effect/unstable/schema/Model`, `@effect/experimental/VariantSchema → effect/unstable/schema/VariantSchema`, `effect/Either → effect/Result`, `effect/JSONSchema → effect/JsonSchema`, `effect/ParseResult → effect/SchemaIssue` + `effect/SchemaParser`, `effect/TRef → effect/TxRef` (and all `T*` → `Tx*`), `effect/FastCheck → effect/testing/FastCheck`.

### `Context.Service` patterns (replaces `Context.Tag` / `Effect.Tag` / `Effect.Service`)
```ts
import { Context, Effect, Layer } from "effect"

// interface-style (function syntax)
const Database = Context.Service<Database>("Database")

// class-style — NOTE argument order flipped vs v3
class Database extends Context.Service<Database, {
  readonly query: (sql: string) => Effect.Effect<Array<unknown>>
}>()("myapp/db/Database") {
  static readonly layer = Layer.effect(this, Effect.gen(function*() {
    return Database.of({ query: (sql) => Effect.succeed([]) })
  }))
}

// with a `make` constructor effect (replaces v3 Effect.Service)
class Logger extends Context.Service<Logger>()("Logger", {
  make: Effect.gen(function*() { /* … */ return { log: Effect.log } })
}) {
  // NO auto-generated `.Default` — build the layer yourself
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Config.layer))
}

// accessors removed; use .use / .useSync (but prefer `yield* Service`)
Logger.use((l) => l.log("hi"))          // Effect<void, never, Logger>
type LoggerShape = Logger["Service"]     // extract the shape type
```
v4 convention: name the layer `layer` (not `Default`/`Live`); variants `layerTest`, `layerConfig`. `dependencies:` option is gone — use `Layer.provide`. `Layer.effect` and `Layer.succeed` are dual: `Layer.effect(Tag, eff)` and `Layer.effect(Tag)(eff)` both work.

---

# 3. End-to-end RPC (verified working)

## 3a. Contract (shared)
```ts
// contract.ts
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export class UserNotFound extends Schema.TaggedErrorClass<UserNotFound>(
  "app/UserNotFound"                       // optional identifier; `()` also valid
)("UserNotFound", { id: Schema.String }) {}

export const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String.check(Schema.isMinLength(1)),
  role: Schema.Literals(["admin", "member"])
})
export type User = typeof User.Type

export class UserRpcs extends RpcGroup.make(
  Rpc.make("GetUser", {
    payload: { id: Schema.String },        // struct fields OR a Schema
    success: User,
    error: UserNotFound
  }),
  Rpc.make("WatchUsers", {
    payload: { since: Schema.Number },
    success: User,                          // element type
    error: UserNotFound,                    // becomes the STREAM error
    stream: true                            // ⇒ RpcSchema.Stream<User, UserNotFound>
  })
) {}
```
`Rpc.make(tag, options)` options: `payload`, `success`, `error`, `defect` (default `Schema.Defect()`), `stream`, `primaryKey`. With `stream: true`, `successSchema` becomes `RpcSchema.Stream(success, error)` and `errorSchema` becomes `Schema.Never`.

`RpcGroup` API: `.add(...rpcs)`, `.merge(...groups)`, `.omit(...tags)`, `.middleware(M)`, `.prefix(p)`, `.toLayer(handlers | Effect<handlers>)`, `.toLayerHandler(tag, h)`, `.toHandlers(...)`, `.of(handlers)`.
`Rpc` per-procedure builders: `.setSuccess/.setError/.setPayload/.middleware/.annotate`; wrappers `Rpc.fork(handlerValue)`, `Rpc.uninterruptible(...)`, plus `Rpc.custom` for schema-transforming constructors (e.g. pagination).

## 3b. Server (Node, WebSocket, ndjson) — **ran successfully**
```ts
// pubsub-server.ts
import { Effect, Layer, PubSub, Schedule, Stream } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { RpcSerialization, RpcServer } from "effect/unstable/rpc"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { createServer } from "node:http"
import { User, UserNotFound, UserRpcs } from "./contract.js"

// server→client push: one PubSub fanned out to every subscriber
const HandlersLayer = UserRpcs.toLayer(Effect.gen(function*() {
  const hub = yield* PubSub.unbounded<User>()
  let n = 0
  yield* Effect.forkScoped(Effect.repeat(
    Effect.suspend(() => PubSub.publish(hub, User.make({ id: String(n++), name: "Ada", role: "admin" }))),
    Schedule.spaced("200 millis")
  ))
  return {
    GetUser: ({ id }) =>
      id === "1" ? Effect.succeed(User.make({ id, name: "Ada", role: "admin" }))
                 : Effect.fail(new UserNotFound({ id })),
    WatchUsers: (_) => Stream.fromPubSub(hub)          // ← streaming procedure
  }
}))

const RpcLayer = RpcServer.layerHttp({
  group: UserRpcs,
  path: "/rpc",
  protocol: "websocket"        // "http" | "websocket" (default websocket)
}).pipe(Layer.provide(HandlersLayer), Layer.provide(RpcSerialization.layerNdjson))

const Main = HttpRouter.serve(RpcLayer).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3111 }))
)
NodeRuntime.runMain(Layer.launch(Main))
```
Note `Schema.Struct#make(...)` — **not** `makeUnsafe` (that method does not exist on `Struct`).

## 3c. Client (browser or node, WebSocket) — **ran successfully**
```ts
import { Context, Effect, Layer, Stream } from "effect"
import { RpcClient, RpcSerialization } from "effect/unstable/rpc"
import { Socket } from "effect/unstable/socket"
import { UserRpcs } from "./contract.js"

const ProtocolLayer = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
  Layer.provide([
    Socket.layerWebSocket("ws://localhost:3111/rpc").pipe(
      Layer.provide(Socket.layerWebSocketConstructorGlobal)   // browser: or BrowserSocket.layerWebSocketConstructor
    ),
    RpcSerialization.layerNdjson
  ])
)

export class UserClient extends Context.Service<UserClient>()("app/UserClient", {
  make: RpcClient.make(UserRpcs)          // Effect<…, never, Protocol | Scope>
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(ProtocolLayer))
}

const program = Effect.gen(function*() {
  const client = yield* UserClient
  const user = yield* client.GetUser({ id: "1" })                 // Effect<User, UserNotFound | RpcClientError>
  const err  = yield* Effect.flip(client.GetUser({ id: "nope" })) // UserNotFound instance, _tag preserved
  yield* client.WatchUsers({ since: 0 }).pipe(                    // Stream<User, UserNotFound | RpcClientError>
    Stream.take(3),
    Stream.runForEach((u) => Effect.sync(() => console.log("push", u.id)))
  )
})
```
Observed output: `UNARY OK: {"id":"1",...}` / `ERROR CHANNEL OK: UserNotFound` / `PUSH: 17 18 19`.

### Error-channel typing (verified by type assertion)
- unary: `Effect<Success, RpcError | RpcClientError | MiddlewareError | MiddlewareClientError, …>`
- streaming: `Stream<Element, StreamError | RpcError | RpcClientError | …, …>`
- `RpcClientError` is always unioned in — it is the transport failure channel (`effect/unstable/rpc/RpcClientError`).
- Per-call options: unary `{ headers?, context?, discard? }` (with `discard: true` the success type becomes `void` and the error type drops to transport-only); streaming `{ asQueue?, streamBufferSize?, headers?, context? }`. **With `asQueue: true` the same method returns `Effect<Queue.Dequeue<A, E | Cause.Done>, never, Scope>` instead of a `Stream`** — so the method type is a union until `AsQueue` is fixed; annotate or pass no options if you want a plain `Stream`.
- `RpcClient.make(group, { flatten: true })` gives a single `(tag, payload, opts)` function instead of an object of methods.
- Headers: `RpcClient.withHeaders(effect, headers)` / `RpcClient.CurrentHeaders` (a `Context.Reference`).

## 3d. Transports and serializations

**Serialization** (`RpcSerialization`, service shape `{ makeUnsafe(): Parser, contentType, includesFraming }`):
| Value / Layer | contentType | framing |
|---|---|---|
| `json` / `layerJson` | `application/json` | ❌ (transport must frame) |
| `ndjson` / `layerNdjson` | `application/ndjson` | ✅ |
| `jsonRpc()` / `layerJsonRpc()` | JSON-RPC 2.0 | ❌ |
| `ndJsonRpc()` / `layerNdJsonRpc()` | JSON-RPC 2.0 NDJSON | ✅ |
| `msgPack` / `makeMsgPack(opts)` / `layerMsgPack` | msgpack (binary) | ✅ |

**Server protocols** (`RpcServer.*`): `layerHttp({ group, path, protocol })` (convenience), `layerProtocolWebsocket({ path })`, `layerProtocolHttp({ path })` (HTTP POST), `layerProtocolSocketServer` (raw TCP/ws via `SocketServer`), `layerProtocolStdio`, `layerProtocolWorkerRunner`, plus `toHttpEffect` / `toHttpEffectWebsocket` for hand-wiring, and `RpcServer.layer(group, opts)` when you supply your own `RpcServer.Protocol`. `layer` options: `{ disableTracing, spanPrefix, spanAttributes, concurrency, disableFatalDefects }`.

**Client protocols** (`RpcClient.*`): `layerProtocolSocket({ retryTransientErrors?, retryPolicy? })` (needs `Socket` + `RpcSerialization`; has built-in 5 s ping/pong keepalive), `layerProtocolHttp({ url, transformClient? })` (needs `HttpClient`), `layerProtocolWorker({ size, concurrency?, targetUtilization? })`. `RpcClient.ConnectionHooks` lets you run an effect on (re)connect.

## 3e. Middleware
```ts
import { Context, Effect, Layer, Schema } from "effect"
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc"

class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>("app/Unauthorized")("Unauthorized", {}) {}
class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()("app/CurrentUser") {}

class AuthMiddleware extends RpcMiddleware.Service<
  AuthMiddleware,
  { provides: CurrentUser }              // also: { requires: … , clientError: … }
>()("app/AuthMiddleware", { error: Unauthorized, requiredForClient: false }) {}

class Api extends RpcGroup.make(Rpc.make("Me", { success: Schema.String })).middleware(AuthMiddleware) {}

const Handlers = Api.toLayer({ Me: () => CurrentUser.use((u) => Effect.succeed(u.id)) })
```
Server impl is a `Layer.succeed(AuthMiddleware)(fn)` where `fn(options)` returns `Effect<Context<Provides>, Error>`; client-side counterpart is `RpcMiddleware.layerClient(tag, service)`. `ApplyServices<M, R> = Exclude<R, Provides<M>> | Requires<M>` — the middleware's `provides` is subtracted from each handler's requirements, and its `error` is added to the client's error channel.

## 3f. Testing
`RpcTest.makeClient(group, { flatten? })` → an in-memory client requiring only `Rpc.ToHandler<Rpcs> | Rpc.Middleware<Rpcs> | Scope` — no transport, no serialization.

---

# 4. v3 → v4 traps (cite `MIGRATION.md` + `migration/*.md` at `Effect-TS/effect@main`)

**Canonical docs location**: `https://github.com/Effect-TS/effect/blob/main/MIGRATION.md` and `migration/{services,cause,error-handling,forking,yieldable,fiber-keep-alive,layer-memoization,fiberref,runtime,scope,equality,generators,schema,v3-to-v4}.md`, plus `LLMS.md` (the official v4 style guide) and `packages/effect/SCHEMA.md`. **`Effect-TS/effect-smol` is a stale mirror** (last push 2026-07-14) that search engines still rank first. **effect.website's narrative docs and API reference are still v3** — do not use them for v4.

| Trap | v3 | v4 |
|---|---|---|
| Service tags | `Context.Tag(id)<Self,Shape>()` / `Effect.Tag` / `Effect.Service` | `Context.Service<Self,Shape>()(id)` — **type params first, id second** |
| "ServiceMap" | — | renamed back to **`Context`** in beta.44. Not a real module today. |
| Auto layer | `Effect.Service` → `.Default` | none; write `static layer = Layer.effect(this, this.make)` |
| Accessors | `MyTag.method(x)` proxy | removed; `Tag.use(s => …)` / `Tag.useSync` / `yield* Tag` |
| `Either` | `Either<A,E>`, `Right`/`Left` | **`Result<A,E>`, `Success`/`Failure`**; `Either.right→Result.succeed`, `left→fail`, `isRight→isSuccess`, `getRight→getSuccess`, `filterOrLeft→filterOrFail`, `fromNullable→fromNullishOr`, `Effect.either→Effect.result` |
| Effect subtyping | `Ref`/`Deferred`/`Fiber` **were** Effects | **`Yieldable`** trait: `yield*` still works for `Option`/`Result`/`Config`/`Context.Service`, but `Ref`/`Deferred`/`Fiber` are plain values — use `Ref.get`, `Deferred.await`, `Fiber.join`. Passing to combinators needs `.asEffect()`. |
| Catch family | `catchAll`/`catchAllCause`/`catchAllDefect`/`catchSome` | **`catch`/`catchCause`/`catchDefect`/`catchFilter`** (uses `Filter`, not `Option`); `catchSomeDefect` removed. New: `catchReason`, `catchReasons`, `catchEager`. |
| Forking | `fork`/`forkDaemon` | **`forkChild`/`forkDetach`**; `forkAll` & `forkWithErrorHandler` removed; all accept `{ startImmediately, uninterruptible }` |
| `Cause` | recursive tree `Empty\|Fail\|Die\|Interrupt\|Sequential\|Parallel` | **flat `{ reasons: ReadonlyArray<Reason> }`**, `Reason = Fail\|Die\|Interrupt`. `isFailure→hasFails`, `failureOption→findErrorOption`, `sequential/parallel→combine` |
| `FiberRef` | `FiberRef.*`, `FiberRefs`, `Differ` | **removed** → `Context.Reference` + the `References` module (`References.CurrentLogLevel`, `.MinimumLogLevel`, `.Scheduler`, `.MaxOpsBeforeYield`, …). `Effect.locally → Effect.provideService`, `locallyWith → updateService`, `locallyScopedWith → updateServiceScoped` |
| `Runtime<R>` | bundled ctx+flags+refs | **removed**; use `Context<R>` + `Effect.runForkWith(services)` |
| Layer memoization | per-`Effect.provide` MemoMap | **shared across `provide` calls**; opt out with `Layer.fresh` or `Effect.provide(l, { local: true })` |
| `Effect.gen(this, fn)` | positional `self` | **`Effect.gen({ self: this }, fn)`** |
| `Equal.equals` | reference equality for plain objects | **structural by default** (objects, arrays, Map, Set, Date, RegExp); `NaN === NaN` is now `true`; opt out via `Equal.byReference` |
| `Scope.extend` | | **`Scope.provide`** |
| `Effect.async` | | **`Effect.callback`** (same for `Stream.async*` → `Stream.callback`) |
| `zipRight`/`zipLeft` | | `Effect.andThen` / `zip`+`map` |
| Request batching | `Effect.withRequestBatching`, `withRequestCaching`, `Request.Cache` | all **removed**; batching/caching now configured on the `RequestResolver` itself (`RequestResolver.setDelay`, `.batchN`, `.withCache`, `.asCache`, `.persisted`). `@effect/experimental/RequestResolver` merged into `effect/RequestResolver`. |
| Streams | | `catchAll→catch`, `fromChunk→fromArray`, `flattenChunks→flattenArray`, `bufferChunks→bufferArray`, `either→result`, `finalizer→ensuring`, `ensuringWith→onExit`, `execute→fromEffectDrain`, `combineChunks→combineArray`, `filterMapWhile→takeWhileFilter`; `distributedWith*`, `broadcastedQueues*`, `accumulateChunks` removed |
| Layers | | `catchAll→catch`, `catchAllCause→catchCause`, `Layer.context→Layer.effectContext(Effect.context<R>())`, `Layer.fail/die/failCause→Layer.unwrap(Effect.fail(...))`, `Layer.memoize` gone (automatic), `Layer.map/project/function/passthrough` all replaced by explicit compositions, `Layer.Layer.Context→Layer.Services` |
| Removed outright | | `Effect.withConcurrency` (+ `"inherit"` concurrency), `Effect.iterate`, `Effect.loop`, `Effect.takeWhile/takeUntil/dropWhile/dropUntil`, `Effect.cachedFunction`, `Effect.transplant`, `Effect.withScheduler`, `Effect.checkInterruptible`, `Effect.dieMessage`, `Effect.if`/`unless` (use `suspend`) |

---

# 5. Zod 4 → Effect Schema v4 cheat-sheet (every row compiled **and** executed)

| zod 4 | Effect Schema v4 |
|---|---|
| `z.object({a: z.string()})` | `Schema.Struct({ a: Schema.String })` |
| `z.infer<typeof S>` | `typeof S.Type` (decoded) / `typeof S.Encoded` (wire) |
| `z.string()` / `.number()` / `.boolean()` | `Schema.String` / `Schema.Number` / `Schema.Boolean` |
| `.min(1).max(10).regex(/…/)` | `Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10), Schema.isPattern(/…/))` |
| `z.number().int().positive()` | `Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))` — `positive/negative/nonNegative` were **removed**; also `Schema.Int`, `Schema.Finite`, `Schema.Natural` exist as canonical schemas |
| `z.string().nonempty()` | `Schema.NonEmptyString` or `.check(Schema.isNonEmpty)` |
| `z.string().uuid()` / `.ulid()` | `Schema.String.check(Schema.isUUID())` / `isULID()` |
| `z.enum(["a","b"])` | `Schema.Literals(["a", "b"])` (array arg — **not variadic**) |
| `z.nativeEnum(E)` | `Schema.Enum(E)` |
| `z.literal("a")` / `z.literal(null)` | `Schema.Literal("a")` / `Schema.Null` |
| `z.union([A,B])` | `Schema.Union([A, B])` (**array**) |
| `z.discriminatedUnion("_tag", [...])` | `Schema.TaggedUnion({ Circle: { radius: Schema.Number }, Square: { side: Schema.Number } })` (discriminant is `_tag`); or `Schema.Union([...])` over `Schema.TaggedStruct`s |
| `z.record(z.string(), z.number())` | `Schema.Record(Schema.String, Schema.Number)` (**positional**, was `{key, value}` in v3) |
| `z.array(A)` / `z.tuple([A,B])` | `Schema.Array(A)` / `Schema.Tuple([A, B])` (array arg); `Schema.NonEmptyArray`, `Schema.UniqueArray` |
| `z.map/set` | `Schema.ReadonlyMap`, `Schema.ReadonlySet`, `Schema.HashMap`, `Schema.HashSet`, `Schema.Chunk` |
| `.optional()` | `Schema.optional(S)` (key absent **or** `undefined`) vs `Schema.optionalKey(S)` (key absent only). Also `Schema.requiredKey`, `Schema.mutableKey`, `Schema.readonlyKey` |
| `.nullable()` / `.nullish()` | `Schema.NullOr(S)` / `Schema.NullishOr(S)` / `Schema.UndefinedOr(S)` |
| `.optional()` → `Option` | `Schema.OptionFromOptional`, `OptionFromNullOr`, `OptionFromOptionalNullOr`, … |
| `.default(3)` | `Schema.Number.pipe(Schema.optionalKey, Schema.withDecodingDefault(Effect.succeed(3)))` — the default is an **Effect**. Variants: `withDecodingDefaultKey`, `withDecodingDefaultType`, `withConstructorDefault` (applies to `.make()` rather than decode) |
| `.refine(pred, msg)` (no narrowing) | `S.check(Schema.makeFilter((n) => n % 2 === 0 ? undefined : "must be even"))` — return `undefined` for OK, a message for failure |
| `.refine` with type predicate | `Schema.refine(refinement)` |
| `.transform(fn)` / `.pipe(B)` | `A.pipe(Schema.decodeTo(B, SchemaTransformation.transform({ decode, encode })))`; fallible: `SchemaGetter.transformOrFail(...)` |
| `.brand<"UserId">()` | `Schema.String.pipe(Schema.brand("UserId"))` — `typeof S.Type` is the branded type |
| `.parse(x)` | `Schema.decodeUnknownSync(S)(x)` (throws `SchemaError`) |
| `.safeParse(x)` | `Schema.decodeUnknownResult(S)(x)` → `Result<A, SchemaError>`; also `decodeUnknownOption`, `decodeUnknownExit`, `decodeUnknownPromise`, `decodeUnknownEffect` |
| `.parseAsync` | `Schema.decodeUnknownEffect(S)(x)` |
| `z.custom` / `instanceof` | `Schema.declare(guard)`, `Schema.instanceOf(Cls)` |
| `z.string().pipe(z.coerce…)` JSON | `Schema.fromJsonString(S)`, `Schema.UnknownFromJsonString` |
| `.extend()` / `.pick()` / `.omit()` / `.partial()` | `S.fieldsAssign(fields)` / `S.mapFields(Struct.pick([...]))` / `Struct.omit([...])` / `mapFields(Struct.map(Schema.optional))` |
| `z.lazy` | `Schema.suspend(() => S)` |
| `z.toJSONSchema` | `Schema.toJsonSchemaDocument(S)` / `toStandardJSONSchemaV1` |
| standard-schema | `Schema.toStandardSchemaV1(S)` (`@standard-schema/spec` is a real dep) |
| error classes | `Schema.TaggedErrorClass<Self>(id?)("Tag", fields)`, `Schema.ErrorClass`, `Schema.Class`, `Schema.TaggedClass`, `Schema.TaggedStruct`, `Schema.Opaque` |

Also renamed vs v3 Schema: `asSchema→revealCodec`, `encodedSchema→toEncoded`, `typeSchema→toType`, `compose→decodeTo`, `annotations→annotate`, `parseJson(S)→fromJsonString(S)`, `Date→DateFromString`, `DateFromSelf→Date`, `*FromSelf` suffixes dropped (`OptionFromSelf→Option`, …), `Redacted→RedactedFromValue`, `TaggedError→TaggedErrorClass`, `decodeUnknown→decodeUnknownEffect`, `decodeUnknownEither→decodeUnknownExit`, `equivalence→toEquivalence`, `arbitrary→toArbitrary`, `pretty→toFormatter`, all filters gained an `is` prefix, `asserts(S)(x)→asserts(S, x)`, and `validate*` / `keyof` / `withDefaults` / `Data(schema)` / `NonEmptyArrayEnsure` were **removed**.

Verified runtime output: `{"retries":3}` from a missing key with `withDecodingDefault`; failure message `SchemaError(must be even)`; `SchemaError(Expected "admin" | "member", got "nope")`.

---

# 6. Beta instability & production risk

1. **Cadence and churn**: 100 betas in ~5.5 months (beta.0 2026-02-18 → beta.102 2026-07-26). Even `beta.102` removes public API: `Effect.withConcurrency` + `References.CurrentConcurrency` + `Types.Concurrency["inherit"]` removed; `Schema.asClass` removed; the `SchemaUtils` module removed; the entire `SchemaRepresentation` module redesigned with a persisted-format break. Expect to re-migrate on every bump.
2. **The `ServiceMap → Context` rename (beta.44)** invalidates essentially all third-party v4 material and LLM priors. Any generated code saying `ServiceMap` is wrong.
3. **`effect/unstable/*` has NO semver guarantee even after 4.0.0 stable.** RPC, HTTP, Socket, Schema-Model, SQL, Workers, Reactivity all live there. For kolu that means the RPC/WebSocket surface is the *least* stable part of the stack.
4. **No v4 narrative docs.** effect.website `/docs/*` is still v3 (its API reference still lists `@effect/rpc`). Sources of truth are the repo's `MIGRATION.md`, `migration/*.md`, `LLMS.md`, `packages/effect/SCHEMA.md`, `.agents/`, and JSDoc in `packages/effect/src` (which is shipped in the npm tarball under `node_modules/effect/src` — read it directly).
5. **Search-engine trap**: `Effect-TS/effect-smol` still ranks first for "effect v4 migration" and is 3 weeks stale; the work moved into `Effect-TS/effect` (a "major repository migration" per the July 2026 recap).
6. **Ecosystem holes**: no v4 for `@effect/typeclass`, `@effect/printer`, `@effect/eslint-plugin`, `effect-http`; `@effect/ai-google` and `@effect/ai-amazon-bedrock` were **deleted** with no replacement. `@effect/language-service` has no v4-specific release (single track, actively updated 2026-07-23).
7. **ESM-only**: `effect@4` has `"type": "module"` and ships **no CJS**. Any CJS consumer in the monorepo (a `require()` script, a CJS jest/config file, an older tool) will break. v3 was dual-format.
8. **268 open issues**, repo pushed the day of this report — active but unsettled. No public stable-release date; the team has only committed to "v4 will be an LTS once stable, with a maintenance schedule published as it approaches stable."
9. **Mitigation**: pin exact versions (`4.0.0-beta.102`, no `^`) across every `@effect/*` in the workspace, and use a pnpm `catalog:` entry so all packages move together.

---

# 7. Vite / browser bundling (measured with Vite 8.2.0 + terser)

**It just works — no config needed.** `vite build` and `vite dev` both handled `effect`, `effect/unstable/rpc`, and `effect/unstable/socket` out of the box (dev prebundled them into `node_modules/.vite/deps/effect.js`, `effect_unstable_rpc.js`, `effect_unstable_socket.js`; ready in 89 ms).

Measured production bundle sizes (min / min+gzip):

| Imports | min | gzip |
|---|---|---|
| `effect/Effect` only | 23.2 kB | **8.4 kB** |
| `+ Schema.Struct` + `decodeUnknownSync` | 77.9 kB | **25.7 kB** |
| `+ RpcSerialization` (alone, on top of Effect) | 52.7 kB | 18.9 kB |
| full RPC client: Effect+Layer+Schema+Stream+Rpc+RpcClient+RpcGroup+RpcSerialization+Socket | 177.3 kB | **60.0 kB** |
| same, via barrels (`from "effect"`, `"effect/unstable/rpc"`) | 177.9 kB | 60.2 kB |

Findings:
- **`sideEffects: []`** in `effect/package.json` ⇒ Rollup tree-shakes aggressively. **Barrel imports cost ~0.6 kB more than deep imports** in a prod build — use whichever reads better; deep imports only meaningfully help dev prebundling granularity.
- **⚠️ `msgpackr` is unavoidably bundled.** `effect/unstable/rpc/RpcSerialization.js` does a top-level `import * as Msgpackr from "msgpackr"`, and msgpackr's `pack.js`/`unpack.js`/`iterators.js` are side-effectful, so it survives tree-shaking **even when you only use `layerNdjson`**. Cost: **~29 kB min / ~10.5 kB gzip** of dead weight in the browser bundle. Workaround if it matters: a Vite `resolve.alias` stub for `msgpackr`, or implement `RpcSerialization.of({...})` yourself instead of importing the module.
- No Node builtins (`node:fs`, `node:net`, …) leak into the browser graph from the RPC/Socket path — verified by grep of the unminified bundle.
- The `effect/unstable/socket` **barrel** pulls `SocketServer` and `Stdio` into the dev prebundle graph; `effect/unstable/socket/Socket` avoids that. Prod output is unaffected.
- SolidJS: use **`@effect/atom-solid@4.0.0-beta.102`** (peer `solid-js >=1 <2`, `effect ^4.0.0-beta.102`). It exports `RegistryProvider`, `RegistryContext`, and hooks `useAtom`, `useAtomValue`, `useAtomSet`, `useAtomRefresh`, `useAtomMount`, `useAtomSubscribe`, `useAtomResource`, `useAtomRef`, `useAtomRefProp`, `useAtomRefPropValue`, `useAtomInitialValues` — all returning Solid `Accessor`s. The atom core itself is now in-tree at `effect/unstable/reactivity/{Atom, AtomRegistry, AtomRef, AsyncResult, Hydration}`, and **`effect/unstable/reactivity/AtomRpc.Service`** wires an `RpcGroup` client directly into atoms (with `AtomHttpApi` for HttpApi) — the shortest path from a streaming RPC to reactive Solid state.
- Browser WebSocket layer: `@effect/platform-browser/BrowserSocket` → `layerWebSocket(url, opts)` / `layerWebSocketConstructor`; or core `Socket.layerWebSocket(url)` + `Socket.layerWebSocketConstructorGlobal` (identical, one fewer package).
- Browser entrypoint: `@effect/platform-browser/BrowserRuntime.runMain`.
