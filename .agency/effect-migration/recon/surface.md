> All paths are relative to `/home/srid/code/kolu/.worktrees/effect`.
> oRPC version pinned everywhere: `^1.13.13`. No Effect dependency exists in the repo yet.

# 1. Executive shape

`@kolu/surface` is a **contract-first declarative reactive-state framework built on top of oRPC**, not a thin wrapper. oRPC supplies four things and nothing else:

1. a **contract builder** (`oc.input().output().errors()`, `eventIterator()`) that `defineSurface` emits programmatically from a spec;
2. a **handler binder** (`implement(contract)` → `root[key][verb].handler(fn)`) that `implementSurface` walks the spec against;
3. a **typed nested-proxy client** (`ContractRouterClient<C>` — `client.surface.<member>.<verb>(input, {signal, context})`) whose *shape* (lazy nested namespaces of callables returning `Promise<AsyncIterable<T>>` for streams) is load-bearing in five different modules;
4. a **peer protocol** (`ClientPeer`/`ServerPeer` from `@orpc/standard-server-peer`) that multiplexes request/response *and* long-lived event-iterators over one duplex byte channel — this is what makes stdio/ssh/unix-socket transports possible at all.

Everything else — the reactive primitives, the pub/sub `Channel`, liveness/heartbeat, the reconnect session loop, health folding, the mirror/re-serve machinery, surface-map's key folding — is **kolu-owned and oRPC-independent**, though written *against* those four shapes.

Blast-radius by package:

| Package | `@orpc/*` deps in `package.json` | Value imports | Type-only imports |
|---|---|---|---|
| `@kolu/surface` | client, contract, server, standard-server, standard-server-peer | 12 files | 8 files |
| `@kolu/surface-map` | client, contract, server | 2 (`define.ts`, `server.ts`) | 1 |
| `@kolu/surface-remote` | client, contract (+ server in devDeps) | 3 (`relayStream`, `reServeSurface`, `session`) | 2 |
| `@kolu/surface-daemon` | server (types only) | 0 | 1 (`daemonMain.ts:28`) |
| `@kolu/surface-app` | **none** | 0 | 0 |
| `@kolu/surface-mcp` | **none** | 0 | 0 |
| `@kolu/surface-daemon-supervisor` | **none** | 0 | 0 |

`@orpc/experimental-publisher` is **not a dependency of any surface package**. `publisherChannel` (`packages/surface/src/server.ts:1099`) is a *structural* adapter to a `{publish, subscribe}` shape; the actual `MemoryPublisher` imports live in `packages/padi/src/publisher.ts:28`, `packages/server/src/surface.ts:439`, and the examples. Pub/sub is kolu's own `Channel<T>` (`server.ts:110-130`). `@orpc/experimental-pino` appears only at `packages/server/src/index.ts:43`.

---

# 2. The wire architecture

## 2.1 Define — `packages/surface/src/define.ts` (1225 lines)

`defineSurface(spec)` walks a declarative spec of five member kinds and **emits an oRPC contract router programmatically**:

- `cellContractEntries` (`define.ts:336`) — `get` → `oc.output(eventIterator(schema))`; `set`/`test__set` → `oc.input(schema).output(z.void())`; `patch` → `oc.input(patchSchema).output(z.void())`.
- `collectionContractEntries` (`define.ts:380`) — `keys` → `oc.output(eventIterator(z.array(keySchema)))`; `get` → `oc.input({key}).output(eventIterator(schema))`; `deltas` → `oc.output(eventIterator(collectionDeltasSchema(...)))` (`define.ts:365`, a `snapshot|delta` discriminated union); `upsert`/`delete`/`test__set` unary.
- `streamContractEntries` / `eventContractEntries` (`define.ts:407,415`) — both `oc.input(inputSchema).output(eventIterator(outputSchema))`. Streams promise snapshot-then-deltas; events do not.
- `procedureContractEntry` (`define.ts:423`) — `oc.input().output().errors(spec.errors ?? {})`, applied **unconditionally**.
- Final assembly at `define.ts:1094-1100`: `oc.router({ surface: inner })`, cast through `AnyContractRouter`.

Three **framework-reserved** procedures are `claim`ed onto every surface (`define.ts:1041-1052`), contract-only, auto-answered by the server:
- `system.live` — `packages/surface/src/liveness.ts:41` (`oc.input(z.object({})).output(z.object({}))`)
- `system.identity` — `packages/surface/src/identity.ts:24+`
- `system.clockNow` — `packages/surface/src/clockNow.ts:38`

A parallel **type-oracle layer** (`define.ts:796-921`, the `buildCell*`/`buildCollection`/`buildStream`/`buildEvent`/`buildProcedure*` functions) exists purely so `ReturnType<typeof buildX<T>>` reads oRPC's internal contract-entry types without spelling them. These are runtime-dead. They must be rewritten 1:1 for any new RPC layer, and `define.ts` documents the "drift watch" between them and the runtime emitters (`define.ts:813-815`).

`composeSurfaceContracts` (`define.ts:1178`) merges N surfaces under `{surface: {<key>: inner}}`; `scopeSibling` (`define.ts:1221`) is the runtime dual — `{surface: link.surface[key]}`.

## 2.2 Serve — `packages/surface/src/server.ts` (3031 lines)

`implementSurface(surface, deps)` → `implementSurfaceOnPublisher` (`server.ts:2655`):
```
const t = implement(surface.contract as any) as any;          // server.ts:2666
const { namespaces, ctx, starts } = walkSurface(t.surface, ...); // server.ts:2667
const router = t.router({ surface: t.router(namespaces) });    // server.ts:2678
```
`walkSurface` (`server.ts:1765`, ~900 lines) is a **runtime string-keyed walk** of the spec that binds `root[key][verb].handler(fn)` for every member (13 `.handler(` sites). It is fully `any`-cast because "oRPC's typed `implement(contract)` chain is too dynamic for our walk" (`server.ts:2661-2665`).

Handler shapes (all `AsyncGenerator`-based for streaming members):
- `cellHandlers` (`server.ts:255-277`) — `get` yields `store.get()` then `for await (const v of bus.subscribe(signal)) yield v`. Snapshot-then-deltas is enforced *here*, not by the wire.
- `collectionHandlers` (`server.ts:425-495`) — `keys`, per-key `get`, batched `deltas`; `subscribeBeforeSnapshot` (`server.ts:399`) subscribes the bus **before** emitting the snapshot to close the lost-update window.
- `streamHandlers` / `eventHandlers` (`server.ts:525,566`) — events forward `deps.source(input, signal)` *directly* with no wrapper generator, because an extra layer put "iterator complete" one tick ahead of the last yield (`server.ts:553-561`, pinned by kolu's `kill.feature` e2e).
- Procedures (`server.ts:2519-2537`) — handler receives `{...opts, ctx}`; oRPC supplies `opts.errors` (the `ORPCErrorConstructorMap`, typed at `server.ts:1393`) and `opts.signal`.
- Reserved verbs auto-answered at `server.ts:2549-2582`.

Siblings: `implementSurfaces` (`server.ts:2976-3009`, N surfaces keyed under one `surface` namespace) and `extendSurface` (`server.ts:2839-2867`, re-adapts two already-built router fragments through a combined contract's matcher).

`serveOverStdio` (`packages/surface/src/peer-server.ts:187`) pumps any router through oRPC's peer protocol:
```
new StandardRPCHandler(router, handlerOptions)                 // peer-server.ts:214
new ServerPeer((message) => framedSend(write, message, endServing)) // :250
peer.message(frame, createServerPeerHandleRequestFn(handler, ctx))  // :279-287
```
`serveOverUnixSocket` (`packages/surface/src/unix-socket.ts`) accepts `net.Socket`s and feeds each into `serveOverStdio` (a Duplex *is* a `{read, write}` pair).

Browser serving is **not** in the surface packages — the consumer does it: `packages/server/src/index.ts:44-45` (`RPCHandler` from `@orpc/server/fetch`, `RPCHandler as WsRPCHandler` from `@orpc/server/ws`), `index.ts:866-873` construction, `index.ts:1192` `wsRpcHandler.upgrade(ws, {context: {...}})`.

## 2.3 Transports (the link family)

| Link | File | Underlying oRPC | Notes |
|---|---|---|---|
| `websocketLink` | `links/websocket.ts:51` | `RPCLink` from `@orpc/client/websocket` | browser leg; consumer supplies a partysocket cast to `WebSocket` |
| `stdioLink` | `links/stdio.ts:224` | `StandardRPCLink` + custom `LinkStdioClient implements StandardLinkClient` wrapping `ClientPeer` | subprocess/ssh |
| `unixSocketLink` | `links/unix-socket.ts:31` | wraps `stdioLink` over a `net.Socket` | local daemon; async (it dials), returns `{client, dispose}` |
| `directLink` | `links/direct.ts:67` | `createRouterClient(router)` from `@orpc/server` | in-process identity element, no transport |
| loopback pair | `loopback.ts` | two cross-piped `PassThrough`s | not a link — feeds `stdioLink` + `serveOverStdio` in tests |

Shared internals in `packages/surface/src/links/_wire.ts`:
- `wireRetryPlugins()` (`_wire.ts:33`) — installs `ClientRetryPlugin<ClientRetryPluginContext>` with `default: {shouldRetry: shouldNotRetryORPCError}`.
- `wireClient<C>()` (`_wire.ts:87`) — `createORPCClient<ContractRouterClient<C, ClientRetryPluginContext>>(link)` **plus** brands the result in a module-private `HALF_OPEN_LINKS` WeakSet (`_wire.ts:63`). `isHalfOpenLink` (`_wire.ts:74`) is consulted by `surfaceClient` to *refuse* a bare wire link that has no liveness watchdog. `directLink` bypasses `wireClient` and brands itself in a separate `DIRECT_LINKS` WeakSet (`direct.ts:37-47`).

**Stdio framing is kolu's, not oRPC's**: `packages/surface/src/links/stdio-codec.ts` — base64 + newline per peer message (`encodeFrame`/`decodeFrame`/`readFramedLines`/`framedSend`). oRPC's `ClientPeer`/`ServerPeer` emit `string | ArrayBufferLike | Uint8Array` per message; kolu adds framing because ssh stdio has none. Documented gotcha: stdout **is** the protocol channel, so `serveOverStdio` redirects `console.log` to stderr when it owns stdout (`peer-server.ts:202-212`).

## 2.4 Consume — `packages/surface/src/solid/surfaceClient.ts` (1513 lines)

`surfaceClient(surface, transport)` walks `surface.spec` and binds each member to `(link as any).surface[key]` (8 such walks), producing `.cells/.collections/.streams/.events/.procedures/.rpc/.health()/.rawStream/.enroll/.dispose`.

- Streams are opened via `unenrolledStreamCall(proc, input, {signal})` (`packages/surface/src/client.ts:175`), which calls `procedure(input, {signal, context: STREAM_RETRY})`.
- `STREAM_RETRY` (`client.ts:130`): `{retry: Infinity, retryDelay: o => o.lastEventRetry ?? 1000, shouldRetry: shouldNotRetryORPCError}`.
- `shouldNotRetryORPCError` (`client.ts:41`): retry anything that is **not** an `ORPCError`, plus the one named retryable code `SURFACE_RELAY_TRANSPORT_LOST`.
- Bound procedures (`surfaceClient.ts:1336-1343`) are the raw oRPC callables re-exposed off the `surface` prefix; their type is `ClientPromiseResult<Out, ErrorFromErrorMap<ProcedureSpecErrors<S>>>` (`surfaceClient.ts:348,389`).
- `isDefinedError` and `safe` are **publicly re-exported** from `@kolu/surface/solid` (`surfaceClient.ts:357`) so apps never import `@orpc/client`.

`surfaceClients(transport, surfaces, onClientError)` (`surfaceClient.ts:1445+`) builds one scoped client per sibling via `scopeSibling`.

`connectSurface` (`packages/surface-app/src/solid/connectSurface.ts:86`) and `connectSurfaces` (`connectSurfaces.ts:124`) are the turnkey seams: `createSurfaceSocket` (partysocket + `pid` echo, `packages/surface-app/src/connect.ts:141`) → `createLiveSignal` → `surfaceClient`/`surfaceClients`.

## 2.5 Mirror remotely — `@kolu/surface-remote`

Chain for the ssh leg:

```
sshConnector(opts)  packages/surface-remote/src/sshConnector.ts:109
  ├ resolveAgentDrv → provisionAgent (nix copy)
  ├ spawn("ssh", [host, `${agentPath}/bin/${binary}`, "--stdio"])   :187
  ├ stdioLink<C>({read: child.stdout, write: child.stdin})          :245
  └ returns Connection<Client> { client, closed, isAlive: surfaceLiveProbe(client), teardown }

makeSession({connectOnce: sshConnector(...)})  session.ts:494
  reconnect/backoff/give-up loop; `Prov` phase vocabulary; heartbeat via
  createHeartbeat + probeSurfaceLive; identity via probeSurfaceIdentity;
  clock offset via measureSurfaceClockOffset (session.ts:1440 catches
  `ORPCError && code === "NOT_FOUND"` for a pre-clockNow server)

pumpRemoteSurface(session, makeSink)  hostFanout.ts:172
  loops over each successive client the session yields, runs ONE
  mirrorRemoteSurface(remote, client, sink) per spawn (surface/src/mirrorRemoteSurface.ts)

reServeSurface({source, policy, session})  reServeSurface.ts
  folds cells/collections into local mirror stores (mirrorReadStore, :77),
  relays streams per RelayPolicy, forwards procedures to the live client,
  then serves the result via implementSurfaceOnPublisher
```

`dialAgentOnce<C>` (`dialAgentOnce.ts`) is the one-shot CLI variant returning `{client, dispose}`.

`relayStream.ts` is the per-stream policy layer:
- `relayHoldOpenStream` (**value**) — rebinds across upstream respawns.
- `relayFailThroughStream` (**delta**) — propagates the end so the browser's `STREAM_RETRY` re-subscribes end-to-end; a middle-hop drop is wrapped as `RelayTransportLostError extends ORPCError<SURFACE_RELAY_TRANSPORT_LOST>` (`relayStream.ts:273-283`), the *only* retryable `ORPCError` code in the system (`relayStream.ts:431` throws it; `client.ts:41` whitelists it).

## 2.6 Keyed maps — `@kolu/surface-map`

`defineSurfaceMap` (`define.ts`) re-derives the *whole* entry contract with every member's input wrapped in a fold envelope `{mapKey: string, input?}` (`envelope.ts:17-33`; `foldInput` at `define.ts:280-284`; per-verb emitters at `define.ts:294-361`), plus an `entries: Collection<Key, EntryStatus>` membership collection (`define.ts:425-428`).

`serveSurfaceMap` (`server.ts`) is a **router transform**: `implement(map.contract)` (`server.ts:591`), then every member gets `makeStreamHandler`/`makeUnaryHandler` (`server.ts:546,562`) which decode the key (`decodeCanonicalWireKey`, `server.ts:534`), resolve the session, and forward via `leafAt(session.link, path)` (`server.ts:345`). Typed rejections: `ORPCError("MAP_KEY_NON_CANONICAL"|"MAP_KEY_UNKNOWN"|"MAP_ENTRY_FAILED")`. Membership loss mid-stream is a **typed end**, never an error frame (`forwardStream`, `server.ts:451-518`).

`connectSurfaceMap` (`client.ts`) builds a per-key `SurfaceClient<ES>` over a **`keyInjectingLink` Proxy** (`client.ts:265-291`) that wraps every leaf call's input in the fold envelope. This is the deepest structural dependency on oRPC's client shape in the codebase: it assumes `link.surface.<member>.<verb>` is a lazily-materializable nested proxy tree of `(input, opts) => …` callables.

---

# 3. What is load-bearing, per oRPC package

### `@orpc/contract`
| Feature | Where | Load-bearing because |
|---|---|---|
| `oc` builder chain | `define.ts:343-432`, `liveness.ts:41`, `identity.ts`, `clockNow.ts:38`, `surface-map/define.ts:294-428` | the *only* way a contract is minted; all programmatic |
| `eventIterator(schema)` | 15 sites | **the streaming primitive.** Every cell `get`, collection `keys`/`get`/`deltas`, stream, event is an event iterator. Without it there is no reactive surface |
| `ErrorMap` / `.errors()` | `define.ts:246,423-432,883-921` | SK6 typed domain errors |
| `AnyContractRouter` | ~15 sites | the erased contract type used everywhere the walk goes dynamic |
| `ContractRouterClient<C, Ctx>` | ~12 sites | the public client type in **every** link signature and downstream consumer |
| `ErrorFromErrorMap` | `surfaceClient.ts:21,348` | the bound-procedure rejection union |

### `@orpc/server`
| Feature | Where | Load-bearing because |
|---|---|---|
| `implement(contract)` | `server.ts:2666,2839,2976`; `surface-map/server.ts:591` | the contract→handler binder for the whole dynamic walk |
| `Router<any, T>` type | `peer-server.ts:92,152`, `unix-socket.ts:24`, `surface-daemon/daemonMain.ts:28,252` | the servable-router shape crossing package boundaries |
| `createRouterClient` | `links/direct.ts:29,70`, `project.ts:37` | `directLink` (the in-process identity element) and `projectSurface`'s in-process A-client |
| `ORPCErrorConstructorMap` | `server.ts:26,1393` | typed `opts.errors` constructors handed to procedure handlers |
| `StandardRPCHandler` + `createServerPeerHandleRequestFn` (`/standard`, `/standard-peer`) | `peer-server.ts:93-101,214,282` | the non-HTTP serve path |
| `StandardRPCMatcher` (`/standard`) | tests only: `define.test.ts:13`, `extendSurface.test.ts:16`, `implementSurface.test.ts:13`, `implementSurfaces.test.ts:17` | **wire-path introspection** — how tests assert `/surface/conn/get` exists and `/surface/conn/set` doesn't |
| `RPCHandler` (`/fetch`, `/ws`) | *not in surface packages* — `packages/server/src/index.ts:44-45` | browser serving is the consumer's |

### `@orpc/client`
| Feature | Where | Load-bearing because |
|---|---|---|
| `createORPCClient` + `ClientLink` | `_wire.ts:13,91` | the one chokepoint minting every wire client |
| `ORPCError` | `client.ts:19,69`; `stdio-codec.ts:21`; `surface-map/server.ts:28`; `surface-remote/{relayStream,reServeSurface,session}.ts` | **the error identity across every hop.** The retry fence (`client.ts:41`), the dead-transport codes (`SURFACE_TRANSPORT_RETIRED`, `SURFACE_STDIO_TRANSPORT_CLOSED`, `client.ts:50-51`), the relay-lost code, and the map's typed rejections are all `ORPCError` instances discriminated by `.code` |
| `ClientRetryPlugin` + `ClientRetryPluginContext` | `_wire.ts:14-17,33-39`; every link; `client.ts:130`; threaded through ~10 public type signatures | **the reconnect-re-subscribe mechanism.** Infinite retry with `lastEventRetry` backoff is how a dropped websocket transparently re-subscribes every stream and gets a fresh snapshot |
| `isDefinedError`, `safe` | re-exported at `surfaceClient.ts:357` | public narrowing API for downstream apps |
| `ClientPromiseResult` | `surfaceClient.ts:16,389` | bound procedure return type |
| `StandardRPCLink`, `StandardLinkClient`, `StandardRPCLinkOptions` (`/standard`) | `links/stdio.ts:27-31,56,213` | `StdioRPCLink extends StandardRPCLink` — the custom transport hook |
| `RPCLink` (`/websocket`) | `links/websocket.ts:18,54` | browser leg |
| `StandardRPCSerializer`/`StandardRPCJsonSerializer` (`/standard`) | `surface-map/foldEnvelope.test.ts:13-16,29` | test asserts the fold envelope survives the **exact** serializer round-trip |

### `@orpc/standard-server` / `@orpc/standard-server-peer`
- `StandardRequest`, `StandardLazyResponse` types — `links/stdio.ts:33-36,183-185`.
- **`ClientPeer`** — `links/stdio.ts:37,59,83,120,168,192`. Owns request/response correlation, event-iterator multiplexing, and abort propagation over the byte channel. `peer.close({reason})` with a typed reason is the #1719 fix (`stdio.ts:164-178`).
- **`ServerPeer`** — `peer-server.ts:102,250,279,332`.
- This pair is **the single hardest oRPC dependency to replace**: it is a full bidirectional multiplexing protocol over an arbitrary duplex, and it is what makes ssh/stdio/unix-socket transports carry streams at all.

### `@orpc/experimental-publisher`
- **Not a dependency.** Only a documented structural shape at `server.ts:1076-1118`. Kolu's own `Channel<T>` / `inMemoryChannel` / `inMemoryPublisher` (`server.ts:110-130, 694-980`) is the real pub/sub. Nothing to port.

---

# 4. The reactive model

**Server→client push is always a client-initiated subscription** returning an event iterator. There is no server-initiated push anywhere.

1. **Producer.** Domain code writes through `ctx.cells.X.set(v)` (`server.ts:2029-2049`) → `equals` dedup → `onWrite` → `store.set` → `bus.publish`. A `Channel<T>` (`server.ts:110-130`) is `{publish, subscribe(signal): AsyncIterable<T>, consume}`.
2. **Handler.** `cellHandlers.get` yields the snapshot then relays the bus (`server.ts:255-277`). `subscribeBeforeSnapshot` (`server.ts:399-410`) ensures subscribe-precedes-snapshot.
3. **Wire.** oRPC serializes each yield as an event-iterator frame over the peer/websocket protocol. `iterateUntilAborted` (`server.ts:1145`) wraps every publisher iterator and **adds one microtask of delay per yield** — this is load-bearing for cross-channel ordering and is regression-pinned by kolu's `kill.feature` e2e (`server.ts:1086-1098`).
4. **Client.** `unenrolledStreamCall` → `createSubscription` (`solid/createSubscription.ts:337`) — `for await (const item of iterable)` into a SolidJS store with `reconcile`, plus `error()`/`pending()`/`complete()` accessors and a `createUpdatedTracker` (`createSubscription.ts:262`) enforcing the **change-iff-fired law** (first frame is a value not a change; an equal reconnect snapshot never fires).
5. **Reconnect.** Two independent legs:
   - **Transport recovery** — partysocket auto-reconnect (browser) or `makeSession`'s dial loop (ssh). `ClientRetryPlugin`+`STREAM_RETRY` then re-issue every in-flight stream; the fresh iterator leads with a fresh snapshot. Note the captured-input hazard documented at `client.ts:161-174`.
   - **Half-open detection** — `createHeartbeat` (`packages/surface/src/heartbeat.ts:194`), framework-free, zero oRPC. Races `probe()` against `timeoutMs`, with wall-vs-monotonic **suspension voiding** (`heartbeat.ts:308-326`), a `VOID_BUDGET_FACTOR` watchdog-of-the-watchdog, and a `wake()` fast path. The probe is always `probeSurfaceLive(client)` → `client.surface.system.live({})` (`liveness.ts:83`).
6. **Liveness brand.** `createLiveSignal` (`solid/liveSignal.ts:199`) builds the link over the socket it watches, wires the heartbeat, and mints an unforgeable `LiveSignalHandle {live, status, link, dispose}` into a module-private WeakSet (`liveSignal.ts:68`). `surfaceClient` **throws** if handed a bare `isHalfOpenLink` client (`surfaceClient.ts:~100-130`).
7. **Health.** `client.health()` (`solid/health.ts`) AND-reduces the transport `live` leg with every `liveWhen` readiness cell (`define.ts:183`) and exposes each enrolled subscription's self-clearing `{name, pending, error}`. `<SurfaceGate>` / `<HostStatusPip>` render the verdict.

---

# 5. Public API that must keep working identically

Downstream consumers: **kolu itself** (`packages/client`, `packages/server`, `packages/padi`, `packages/kaval`, `packages/xterm-kit`), **drishti** (tight pair, gated by `.claude/rules/surface.md`), **odu** (loose npins pin). Reference docs at `website/src/content/surface/ref-surface*.mdx` are gated by `.claude/rules/surface-reference.md`.

**Declaration:** `defineSurface`, `defineSurfaceWithPolicy<TPolicy>()`, `SurfaceSpec`/`CellSpec`/`CollectionSpec`/`StreamSpec`/`EventSpec`/`ProcedureSpec`, `SurfaceTypes<S>` + the flat `SurfaceCellValue`/`SurfaceCollectionKey`/… helpers, `composeSurfaceContracts`, `isContractVersionCompatible`, `collectionDeltasSchema`, `resolveCellVerbs`/`resolveCollectionVerbs`/`collectionHasDeltas`. **All schemas are zod `ZodType`.**

**Serving:** `implementSurface`/`implementSurfaceOnPublisher`/`implementSurfaces`/`implementSurfacesOnPublisher`/`extendSurface`, returning `SurfaceRuntime {router, ctx, done, close}`. Stores/channels: `inMemoryStore`, `inMemoryCollection`, `confStore`, `inMemoryChannel`, `inMemoryChannelByName`, `publisherChannel`, `isAbortReason`, `iterateUntilAborted`, `superviseTerminalSource`.

**Transports:** `websocketLink`, `stdioLink`, `unixSocketLink`, `directLink`, `serveOverStdio` (+ `ServeOverStdioEnd`), `serveOverUnixSocket`, `getRuntimeSocketPath`, `createLoopbackPair`.

**Client:** `surfaceClient`, `surfaceClients`, `buildSurfaceClient`, `createLiveSignal`/`LiveSignalHandle`, `createSubscription`/`createReactiveSubscription`/`Subscription<T>`, the `.use()` hooks (`useCell`/`useCollection`/`useStream`/`useEvent`), `createKeyedRoot`, `keyedSubscriptionCache`, `client.health()`/`SurfaceHealth`/`mergeSurfaceHealth`/`surfaceClientsHealth`, `<SurfaceGate>`, `<HostStatusPip>`, `unenrolledStreamCall`, `client.rawStream`, `client.enroll`, `isDefinedError`, `safe`.

**Remote:** `makeSession`/`Session`/`Connector`/`Connection`/`ConnectError`, `sshConnector`, `dialAgentOnce`, `pumpRemoteSurface`, `buildRemotePool`, `reServeSurface`, `relayHoldOpenStream`/`relayFailThroughStream`/`RelayPolicy`, `serveHostMap`, `mirrorRemoteSurface`/`SurfaceSink`, `projectSurface`/`deriveCell`/`deriveStream`/`deriveEvent`.

**Map:** `defineSurfaceMap`, `serveSurfaceMap`, `connectSurfaceMap`, `Entry`/`EntryStatus`/`KeyCodec`/`MembershipId`.

**Daemon:** `daemonMain`/`daemonHome`/`frontDaemonOverStdio`/`controlCoreSurface`, `convergeAdmit`/`probeDaemonIdentityFrom`.

Types that **would change shape** under a transport swap and are therefore the API-break surface:
- `ContractRouterClient<C, ClientRetryPluginContext>` — the return type of every link, `Connection.client`, `AgentClient<C>`, `LiveSignalHandle.link`.
- `ClientRetryPluginContext` — appears in ~10 exported signatures.
- `StreamingProcedure<I,O> = (input, {signal, context}) => Promise<AsyncIterable<O>>` (`client.ts:140`) — the shape every hook, sink, relay, and mirror consumes.
- `ORPCError`, `isDefinedError`, `safe`, `ErrorFromErrorMap`.
- `Router<any, T>` in `serveOverStdio`/`serveOverUnixSocket`/`daemonMain` signatures.

---

# 6. Tests

138 test files across the seven packages (surface 45, surface-remote 35, surface-daemon-supervisor 14, surface-app 13, surface-daemon 12, surface-map 9, surface-mcp 5).

### Would need rewriting — hard-coupled to oRPC internals

| File | Coupling |
|---|---|
| `surface/src/define.test.ts:13,29-34` | `StandardRPCMatcher` path introspection (`/surface/conn/get`) |
| `surface/src/implementSurface.test.ts:13` | same — asserts router depth `/surface/<prim>/<verb>` not `/surface/surface/…` |
| `surface/src/implementSurfaces.test.ts:16-17` | `StandardRPCMatcher` + `call` from `@orpc/server` |
| `surface/src/extendSurface.test.ts:16` | `StandardRPCMatcher` |
| `surface/src/peer-server.test.ts:12-16` | builds a raw `ClientPeer`, hand-crafts `StandardRequest`s, uses `implement`+`oc` fixtures |
| `surface/src/peer-server.lifetime.{contract,fixture.testlib,test}.ts` | `oc`, `eventIterator`, `implement` |
| `surface/src/links/stdio.test.ts:15-17` | `ORPCError`, `oc`, `eventIterator`, `implement` — pins abort propagation and the stdout-corruption failure mode |
| `surface/src/unix-socket.test.ts:28` | `implement`, `Router` |
| `surface/src/procedureErrors.test.ts:19` | `isDefinedError`, `ORPCError`, `safe` over a **real** `serveOverStdio`+`stdioLink` wire |
| `surface/src/solid/boundProcedure.test-d.ts:33-34` | type-level pins on `ContractRouterClient`/`ClientRetryPluginContext` |
| `surface-map/src/foldEnvelope.test.ts:13-16` | `StandardRPCSerializer` round-trip — **the single most oRPC-specific test in the tree** |
| `surface-map/src/{mapHarness,procedureErrorsAcrossMap,procedureUseVerb,clientPolicyOrigin}.test.ts` | `AnyContractRouter`, `implement`, `ORPCError`, `createRouterClient` |
| `surface-remote/src/{recheck,reconnect-spin}.test.ts` | `oc`, `eventIterator`, `implement` fixtures |
| `surface-remote/src/{relayStream,reServeSurface}.test.ts` | `ORPCError` (the relay-lost code), `createRouterClient` |
| `surface-remote/src/serveHostMap.test.ts:16` | `AnyContractRouter` |

### Should pass essentially unchanged — no oRPC surface

- `heartbeat.test.ts` (408 lines) — pure timers/clock algebra.
- `wsOrigin.test.ts`, `time.ts`-adjacent, `channelNames.test.ts`, `inMemoryChannel.test.ts`, `wait.test.ts`, `clockNow.test.ts` (schema-level).
- The whole reactor suite: `reactor.test.ts` (1594), `reactorEngineLaws.test.ts`, `reactorFamily.test.ts`, `reactorLoopGuard.test.ts`, `collectionDeltas.test.ts`.
- Solid client suite driven off `AsyncIterable` stubs: `createSubscription.test.ts` (862), `createReactiveSubscription.test.ts`, `keyedSubscriptionCache.test.ts`, `useCellCoalesce.test.ts`, `health.test.ts`, `gracedDown.test.ts`, `createLiveSignal.test.ts`, `SurfaceGate.test.tsx`, `HostStatusPip.test.tsx`.
- **All 13 `surface-app` tests** and **all 14 `surface-daemon-supervisor` tests** (no `@orpc` import anywhere).
- `surface-mcp`'s 5 tests (structural client shape only).
- `surface-daemon`'s 12 tests except where they cross the socket.
- Most of `surface-remote`'s 35 (session state machine, provisioning, nixCopy, agentDrv, arch, controlMaster, processExit, livenessOrdering, terminalGiveUp…).

Roughly **~20 of 138 need real rewriting**; another ~10 need fixture-shape edits.

---

# 7. Candid assessment: what maps cleanly to Effect RPC vs. what needs design

## Maps cleanly

1. **Event iterators → `Stream`.** Every streaming member is `eventIterator(schema)` with snapshot-then-deltas semantics enforced *by the handler generator*, not the wire. `@effect/rpc`'s `Rpc.make(tag, {stream: true, success})` returning a `Stream` is a direct substitute, and the server-side generators become `Stream.fromAsyncIterable`/`Stream.unwrapScoped` with essentially no semantic change.
2. **Typed errors.** `ProcedureSpec.errors` → `ORPCErrorConstructorMap` → `isDefinedError`/`safe` maps *better* onto Effect's typed error channel (`Rpc.make(tag, {error: Schema.TaggedError})`). Effect wins here: the "undeclared throws collapse to INTERNAL_SERVER_ERROR" fail-fast rule becomes `Effect.die` vs `Effect.fail`, which is more honest. Public API change though: `isDefinedError`/`safe` (`surfaceClient.ts:357`) disappear in favor of `Effect.catchTag`.
3. **Abort/cancellation.** `{signal}` threading is uniform and total — every handler takes `signal`, every client call takes `{signal}`, `iterateUntilAborted`/`isAbortReason` (`server.ts:1128,1145`) is the one swallow rule. Effect's fiber interruption is strictly more expressive; the adapter at the boundary is mechanical (`Effect.runPromise` + `AbortSignal` bridging).
4. **Heartbeat / liveness / health.** `heartbeat.ts`, `liveness.ts`, `health.ts`, `liveSignal.ts` are oRPC-free. `probeSurfaceLive` is one call; `system.live` is one reserved tag. Ports as-is.
5. **Pub/sub.** No `@orpc/experimental-publisher` dependency to port. `Channel<T>` could become `PubSub`/`Queue` but there is no forcing function — leave it.
6. **Stdio/socket transports.** `@effect/rpc` ships `RpcServer.layerProtocolStdio` and socket protocols with ndjson serialization. The base64+newline framing (`stdio-codec.ts`) and the `ServerPeer`/`ClientPeer` wiring would be *deleted*, not ported. Both ends are kolu-controlled, so the wire break is acceptable — except see #4 below.
7. **`surface-app`, `surface-mcp`, `surface-daemon-supervisor`.** Zero oRPC. They only need type-signature refits where they touch `Router`/`ContractRouterClient` via re-exports.

## Needs real design work

1. **zod → Effect Schema is the largest single item.** Every `CellSpec.schema`, `keySchema`, `patchSchema`, `inputSchema`, `outputSchema` is `ZodType` (`define.ts:130-247`), and every downstream surface declaration in kolu, drishti, and odu is written in zod. `@effect/rpc` payloads are `Schema.Schema`. Options: (a) migrate all declarations to Effect Schema — a breaking change to every consumer; (b) adapt zod at the boundary via Standard Schema — Effect Schema's Standard-Schema *output* is stable but consuming an arbitrary standard schema as an Rpc payload is not; (c) keep zod for validation and use `Schema.Any` on the wire — loses Effect's derivation benefits. None is free. Note `foldEnvelope.test.ts` exists precisely because a zod patch-version change (`z.void()` strictness at 4.3.7) once broke the map wire — the schema layer is already a known fragility.

2. **The nested-namespace client proxy has no Effect equivalent.** oRPC gives `client.surface.<member>.<verb>(input, opts)` as a lazily-materialized proxy tree at arbitrary depth. Five modules depend on this shape structurally:
   - `surfaceClient.ts` — 8 `(link as any).surface[key]` walks;
   - `scopeSibling` (`define.ts:1221`) and `surfaceClients`;
   - `probeSurfaceLive` (`liveness.ts:84`) — `client.surface.system.live`;
   - `leafAt` (`surface-map/server.ts:345`) — walks an arbitrary `path`;
   - **`keyInjectingLink`** (`surface-map/client.ts:265-291`) — a Proxy-of-Proxy that intercepts *every* leaf call to fold `{mapKey, input}`.

   Effect RPC methods are **flat, string-tagged**. The namespace tree must be encoded into tags (`"surface.terminals.get"`) and the nested-proxy face hand-built on top — meaning kolu now owns the proxy machinery oRPC provided for free. `keyInjectingLink` in particular becomes a middleware/interceptor rather than a proxy; that is arguably cleaner but is a rewrite, not a port.

3. **`ClientRetryPlugin` + `STREAM_RETRY` semantics.** "Retry transport errors forever with `lastEventRetry` backoff; never retry an application error; except retry exactly `SURFACE_RELAY_TRANSPORT_LOST`" (`client.ts:32-44,130-134`). Effect has `Stream.retry(Schedule)` and typed error channels, so the *discrimination* becomes cleaner (retry on the transport error type, not on an `instanceof ORPCError` + code string). But the **`lastEventRetry` field** is a protocol-level SSE-style server-suggested retry delay — Effect RPC has no equivalent, so that becomes a fixed or app-supplied schedule. Also: the current design makes re-subscribe *transparent* to `createSubscription` (the iterator just keeps yielding); in Effect the retry has to be inside the `Stream` before it reaches the Solid bridge, or the change-iff-fired law and the "reconnect snapshot leads a fresh stream" invariant break.

4. **`frontDaemonOverStdio` is a contract-blind raw byte relay** (`surface-daemon/src/frontDaemonOverStdio.ts:24-33`): it splices stdin⇄stdout onto a unix socket with **no decode**, relying on `serveOverUnixSocket` and `stdioLink` speaking the *same* framing. It survives a framing change only if both ends move together — which they do, but the daemon upgrade-window tests (`upgradeWindow.*.testlib.ts`, and drishti's imported `./upgrade-window.testlib`) deliberately run an *old* daemon against a *new* supervisor. A wire-format change breaks that cross-version window by construction. This needs an explicit migration story.

5. **`directLink` as the identity element.** `createRouterClient(router)` gives an in-process client of the *same type* as a wire client, with no serialization and microtask-deferred handler calls (`links/direct.ts:1-26`). `projectSurface` (`project.ts:37`) and `surface-mcp` (`compose.test.ts`, `server.ts`) depend on this. Effect's `RpcTest.makeClient` is the nearest thing but is test-flavored; `RpcServer` over an in-memory protocol adds serialization. Getting a true no-serialization identity link with the same type is design work — and `directLink`'s honesty (it can't half-open, so its `live` is constant-`true` by construction, `direct.ts:31-47`) is a correctness invariant, not a convenience.

6. **The `implement(contract)` dynamic walk.** `walkSurface` (`server.ts:1765-2600`) binds handlers by string-indexing `root[key][verb].handler(fn)` against a contract built at runtime from a spec. `RpcGroup.make(...)` is variadic and type-driven; building one dynamically from an arbitrary spec object, and typing the result as precisely as `SurfaceContractFor<S>` does today, is the hardest *type-level* problem in the migration. The entire type-oracle block (`define.ts:796-921`) plus `CellContract`/`CollectionContract`/`UnionToIntersection`/`MergeContract` (`define.ts:446-663`) is rewritten from scratch. Expect TS2590 "union too complex" pressure — the codebase already documents hitting it (`connectSurface.ts:69-75`, `surface-map/client.ts:69-72`, `surface-mcp/server.ts:52-60`).

7. **`extendSurface`'s router re-adaptation** (`server.ts:2803-2867`) — two already-built router fragments passed *through* `implement(combined).router({...})` so they re-adapt against the combined contract's matcher and survive the wire path matcher, not just `directLink`. There is no obvious Effect analogue for "re-adapt a built handler layer against a different group"; `Layer.merge` of two `RpcGroup` layers is probably right but the byte-identical-path guarantee (`ref-surface.mdx`) needs re-proving.

8. **Error-shape identity across hops.** `ORPCError` with a `.code` string is the *lingua franca* across four hops (browser ↔ parent ↔ ssh agent ↔ daemon) and three packages independently discriminate on it: `isDeadTransportError` (`client.ts:81`), `isSurfaceStdioTransportClosed` (`client.ts:100`), `isSurfaceRelayTransportLost` (`client.ts:118`), `shouldNotRetryORPCError` (`client.ts:41`), the map's three typed rejections, and `session.ts:1440`'s `NOT_FOUND` check for pre-`clockNow` servers. Effect's tagged errors are better *within* one process, but preserving a code **across a re-serve relay that wraps an upstream error and re-throws it downstream** (`relayStream.ts:289-312,431`) requires the tagged error to survive serialize→deserialize→re-serialize at the middle hop. That is a `Schema.TaggedError` union that must be shared by all three tiers — designable, but it is a cross-package contract that does not exist today (today it's a magic string).

## Sequencing suggestion

The dependency arrow is `surface → surface-map → surface-remote`, with `surface-app`/`surface-mcp`/`surface-daemon-supervisor` structurally decoupled (zero oRPC). A migration that starts at `links/` + `peer-server.ts` (the transport leaf) and works *inward* to `define.ts`/`server.ts` will hit the schema and nested-proxy problems immediately; starting at `define.ts` with a zod-compat shim and keeping the oRPC transport underneath is not possible either, since `oc`+`eventIterator` *is* the contract. Realistically the whole `defineSurface`/`implementSurface`/link triad moves in one step, and `surface-map`'s `keyInjectingLink` is the piece most likely to force a design change to the client face that then propagates back into `surfaceClient.ts`. Budget the drishti pair-PR gate (`.claude/rules/surface.md`) and the odu-impact verdict as first-class work — this is the largest API-facing change the shared stack has ever taken.
