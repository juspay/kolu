# W2 fanout — `@kolu/surface-app` on the Effect surface core

Scope delivered: `src/surface.ts` (zod → Effect Schema + byte fixtures),
`src/connect.ts` (partysocket → `websocketLink`), `src/lifecycle.ts`
(`retireSocket` deleted), `src/solid/index.ts` (`createServerLifecycle` +
`SurfaceAppProvider` on the `WatchableWire`), `src/solid/connectSurface.ts`,
`src/solid/connectSurfaces.ts`, `src/server.ts` (Effect procedure impls + the NEW
RPC serving seam), one new test-only `src/fakeSocket.testlib.ts`, and every test
file that touched a changed shape. `index.ts`, `notify.ts`, `vite.ts`, `bun.ts`,
`client.d.ts` were untouched (no framework contact).

---

## 1. What replaced what

| was | is |
|---|---|
| `new PartySocket(urlThunk, …)` inside `createSurfaceSocket` | `websocketLink({ group, url, isTerminalClose, connect })` (S4) |
| `SurfaceSocket { ws, echo }` | `SurfaceSocket { link: WebsocketLink, echo }` — `link` IS the `{ dispatch, wire }` pairing S3's `createLiveSignal` takes whole |
| `retireOnStaleClose(ws, code)` + `retireSocket(ws)` (close + `send` poisoning) | the link's terminal-close classifier + the terminal `WireStatus` `"retired"` (review #5) |
| `CreateLiveSignalOptions.retireOnStaleClose` / `restartCloseCode` | gone — surface-app feeds the LINK its close-code vocabulary once, as `isTerminalClose` |
| `createServerLifecycle({ ws })` observing `open`/`close` events | `createServerLifecycle({ wire })` observing `wire.onStatus` |
| `HeartbeatSocket { readyState, OPEN, reconnect }` | `WatchableWire` (`status()` gate, `forceReconnect()` action) |
| `z.object` / `z.infer` / `z.ZodType<T>` | `Schema.Struct` / `typeof S.Type` / `WireSchema<T>` |
| `identity.info: async () => ({ processId })` | `identity.info: () => Effect.succeed({ processId })` |
| `wsRpcHandler.upgrade(ws, { context })` at the app's call site | **`serveSurfaceSocket({ group, handlers, socket, services? })`** (new, §4) |

### `isStaleProcessClose` — the one place the close code lives now

`STALE_PROCESS_CLOSE_CODE` (4001) stays in surface-app (`@kolu/surface` may not
import it — the dependency arrow points the other way), and is handed to the link
as its REQUIRED `isTerminalClose` classifier. That is the whole of surface-app's
remaining close-code knowledge: nothing downstream of the link ever sees a close
CODE again. `connect.test.ts` pins the app-side contract (a 4001 close ⇒ one dial,
zero re-dials, `wire.status() === "retired"`; every other code re-dials); the
link's own law is pinned in `@kolu/surface`'s `links/websocket.test.ts`.

### The pid echo is unchanged in kind and stronger in mechanism

`createProcessIdEcho` is byte-identical. The thunk is now `websocketLink`'s `url`
option, which Effect's socket layer acquires per RUN while the protocol RETRIES the
run — so "re-evaluated on every re-dial" is structural rather than a property of
partysocket's constructor. Pinned end to end (`createSurfaceSocket` dials
`ws://test/rpc/ws`, drops, re-dials `…?pid=p1`).

---

## 2. `createServerLifecycle` on a status stream

`retired` is the definitive restart. Concretely:

- `open` → probe → `connected` / `reconnected` / `restarted{transport:"open"}`;
- `closed` → `disconnected` (gated on an established identity, as before);
- `retired` → `restarted{transport:"closed"}` (gated the same way);
- `connecting` → not a transition (it is either the cold start, already the initial
  state, or the re-dial that follows the `closed` just reported).

Two behaviour notes:

1. **A wire that is already `open` at construction is probed.** The status stream
   reports CHANGES only, and the link's dial runs on its own fiber, so a caller that
   `await`ed `createSurfaceSocket` may well hold an open wire. Without the
   construction-time read the connection would sit in `connecting` forever with no
   probe ever issued. New test.
2. **`onStaleRestart` is deleted, not renamed.** It existed so a consumer could
   `retireSocket(ws)` at the one site that decoded the stale close. Both halves are
   gone: the link halts its own retry schedule and fails every in-flight and future
   call with `SurfaceTransportRetired`, so there is no consumer action left to hand
   out. Same for `restartCloseCode` on both `createServerLifecycle` and the provider.

---

## 3. Which side of a schema each position speaks

`ServerProbeSchema` = `Schema.Struct({ processId: Schema.String })`;
`ServerProbeInputSchema` = `Schema.Struct({})`, **not `Schema.Void`** — D8's
measured divergence (3) says `Void` encodes as `null`, which would change the
handshake frame for a member whose shape is part of the app protocol. Byte-level
fixtures (W3 #17 obligation, this is a WIRE format): `{"processId":"p1"}` out,
`{}` in, plus a negative (a frame with no `processId` is REJECTED — the field is
required, never `optionalKey`). No `.optional()`/`.default()` idiom existed in this
package, so the #17 mapping table had nothing to translate.

`BuildInfoDef.schema` / `defineBuildInfo`'s `schema` are `WireSchema<T>`
(`Schema.Codec<T, unknown, never, never>`) — the same context-free bound S1 put on
every spec schema, so a schema demanding a service is not assignable.

---

## 4. The server serving seam (PLAN D5 / review #6) — the W4 hand-off

`acceptSurfaceSocket`'s gate → enrol → dispatch order is UNCHANGED, and `accept`
still takes the app's `onAccepted` closure — because the dispatch is the one step a
generic seam cannot decide (drishti's `?host=` routing, kolu's `__admin__`
sentinel). What changed is what that closure calls:

```ts
serveSurfaceSocket<Svc>(opts: {
  group: RpcGroup.RpcGroup<Rpc.Any>;   // runtime.group
  handlers: SurfaceHandlers;           // runtime.handlers
  socket: ServableSocket;              // the accepted `ws` socket, structurally
  services?: Layer.Layer<Svc>;         // this connection's own services
}): SurfaceSocketServing               // { close(): void; done: Promise<void> }
```

Design decisions, each load-bearing:

1. **Per-connection `RpcServer` over the SHARED handlers**, built on a
   ONE-CONNECTION `SocketServer` — the websocket twin of `@kolu/surface/unix-socket`'s
   accepted-connection serving. `RpcServer.layerHttp` / `layerProtocolWebsocket`
   are NOT used: both own the upgrade, and owning the upgrade means owning the
   ordering the stale-tab gate and the ws reaper must run in front of (kolu#1231).
2. **`services` is a Layer, not synthetic headers.** PLAN D5 sketched injecting
   `HttpServerRequest.remoteAddress` as a header before `onSocket` so a
   `CurrentViewer` middleware could read it. That path does not exist on the
   socket-server protocol: `makeProtocolSocketServer` calls `server.run(onSocket)`
   with the socket ALONE — the `headers` parameter of the private `makeSocketProtocol`
   is reachable only from `makeProtocolWithHttpEffectWebsocket` (the effect-http
   upgrade route). Since each connection already gets its own serving stack, the
   per-viewer fact is simply a service that stack provides. **W4 (kolu-server) wires
   `viewerAddress` / `forwardedFor` here**, from `req.socket.remoteAddress` and the
   upgrade request's headers, as `Layer.succeed(CurrentViewer)({…})`.
3. **Inbound frames are BUFFERED until the RPC server attaches its listener.** `ws`
   emits the moment the upgrade completes; `Socket.fromWebSocket` attaches its
   `message` listener inside an Effect run. A client that sends in the same tick as
   the accept — every reconnecting client, which re-issues its subscriptions on
   open — would otherwise have that frame dropped and hang forever with no error
   anywhere. `bufferedSocketView` subscribes synchronously inside
   `serveSurfaceSocket` and replays in arrival order. **Verified non-vacuous**: with
   the buffering swapped for a pass-through, the pinning test fails (times out).
4. **`done` must be observed**, same contract as `SurfaceRuntime.done`: it rejects
   on a serving-stack build failure and resolves when serving ends (peer hang-up,
   the reaper's `terminate()`, or `close()`). An ignored rejection is an unhandled
   one — the loud channel a silently dead connection deserves.

Tested end to end with a REAL round trip: a real `implementSurfaces` runtime on one
end, a real `websocketLink` on the other, real ndjson frames, over a paired
in-memory socket (`socketPair()`), with no `ws` dependency and no listening port.
Six tests: a real call answered; the same-tick frame answered; a stale tab never
served (gate ordering); `done` settles on peer hang-up; `close()` idempotent; two
peers isolated (one teardown leaves the other answering).

---

## 5. Public API breaks (additions to the drishti/odu follow-up list)

Beyond S1–S4's lists:

1. **`connectSurface` and `connectSurfaces` are ASYNC** (`Promise<SurfaceConnection>` /
   `Promise<SurfacesConnection>`) — the dial is an effect. `dispose()` is async too
   (it releases the link's scope).
2. `SurfaceConnection.ws: PartySocket` → **`.link: WebsocketLink`**
   (`{ dispatch, wire, dispose }`). Same for `SurfacesConnection`.
3. `SurfacesConnection` **lost its `C extends AnyContractRouter` type parameter and
   its `.link` field** (there is no contract client to expose). The combined dispatch
   is reachable as `conn.transport.dispatch`; `.transport` is now the non-generic
   `LiveSignalHandle`.
4. `ConnectSurfaceOptions` / `ConnectSurfacesOptions` lose **`socketOptions`**
   (partysocket's), **`retireOnStaleClose`** and **`restartCloseCode`**; they gain
   **`connect?: (url) => WebSocket`** (the platform binding). `connectSurfaces`
   derives the combined `RpcGroup` from `surfaces` itself
   (`composeSurfaceContracts`), so no group is passed.
5. `SurfaceSocketOptions` gains a REQUIRED **`group`** and loses `socketOptions` /
   `retireOnStaleClose` / `restartCloseCode`. `createSurfaceSocket` is **async**.
6. **Deleted**: `retireSocket` (both from `/lifecycle` and the `/solid` re-export),
   `retireOnStaleClose`, `SurfaceSocket.ws`, `WsLike`, `HeartbeatSocket`, and the
   `WatchableSocket` re-export.
   **New**: `isStaleProcessClose`, `ServerProbeInputSchema`, `ServableSocket`,
   `serveSurfaceSocket`, `SurfaceSocketServing`; `/solid` re-exports `WatchableWire`
   and `WireStatus`.
7. `createServerLifecycle({ ws })` → **`({ wire })`**; drops `restartCloseCode` and
   `onStaleRestart`. `HeartbeatOptions.ws` → **`.wire`**; `normalizeHeartbeat`'s base
   is `{ wire, probe }`.
8. `ConnectionSource`'s turnkey arm is **`{ wire, probe }`** (was `{ ws, probe }`),
   and drops `restartCloseCode`. `<SurfaceAppProvider>` follows.
9. `surfaceAppProbe(client: { rpc: unknown })` → **`{ rpc: SurfaceFace }`**, and it
   THROWS on a face with no `identity.info` (the wrong-client mistake) instead of
   returning a rejection that would read as a transient probe failure.
10. `serverIdentity()` / `surfaceAppServer()`'s `procedures.identity.info` returns an
    **`Effect`**, not a Promise (S2's one-arm `ProcedureImpl`).
11. `BuildInfoDef.cells.buildInfo.schema` and `defineBuildInfo`'s `schema` are
    `WireSchema<T>`; `ServerProbe` is derived via `typeof …Schema.Type` (readonly
    fields).

---

## 6. Deviations / deliberate residue

1. **`package.json` untouched** (W6 owns dep removal), so `zod` and `partysocket`
   remain DECLARED while zero source files import them. PLAN standing rule 5 does
   not fire: no `dependencies` block changed. No NEW dep was needed —
   `effect` and `@kolu/surface` were already declared, and the seam's
   `effect/unstable/{rpc,socket}` subpaths come from `effect`.
2. **`website/src/content/surface/ref-surface-app.mdx` is NOT updated here.** §5 is a
   long list of breaks, but W6 already owns "examples + website surface reference
   MDX", the file lives outside this package (concurrent agents share the worktree),
   and a Reference rewrite landed now would be stale before it was read — S3 §10.2
   made the same call for `ref-surface.mdx`. §5 is written as the changelog that
   pass consumes. **Flag it if W6 slips.** The package README's one snippet WAS
   updated (it is in-package and its `{ ws }` destructure no longer exists).
3. **`packages/surface-app/example/` is untouched** — it is a separate workspace
   package (`@kolu/surface-app-example`) with its own `typecheck`, still on
   oRPC + zod, and `recon/zod.md` files it under "Examples / demos" which PLAN W6
   owns. It is currently RED and will stay red until W6; its `main.ts` needs
   `serveSurfaceSocket` + `implementSurfaces`'s `{ group, handlers }`, and its
   `wire.ts` needs the async `connectSurfaces`. `ci/mod.just` has a
   `surface-app-example-build` node — **W6 must land the example before that node
   can be green.**
4. **`biome format` was scoped to `packages/surface-app`**, not run repo-wide via
   `just fmt`: concurrent W2 agents are editing sibling packages in this worktree,
   and a repo-wide write would touch their in-flight files. Same call S4 made.
5. **`connectSurfaces.test.ts` still mocks `@kolu/surface/heartbeat`** (to capture
   the probe thunk without waiting out a 15s interval) but no longer mocks
   `../connect`: the socket is faked through the link's own `connect` seam, so the
   whole surface-app path under test is real production code. The one stand-in that
   remains needed a `.catch()` on the probe promise — the real `createHeartbeat`
   always attaches handlers, and `createLiveSignal.dispose()` INTERRUPTS an
   in-flight probe, whose promise then rejects.
6. **`WEBSOCKET_ADDRESS` is a placeholder.** `SocketServer.Address` is
   `TcpAddress | UnixAddress`; neither describes an already-upgraded websocket, and
   nothing in Effect's socket-server protocol reads `address`. Spelled once, with
   the reason, rather than invented per call site.

---

## 7. Notes for the reconcile pass (core observations, nothing edited)

- `@kolu/surface`'s `solid/liveSignal.ts` probe promise rejects with
  `Cause.squash` on interruption ("All fibers interrupted without error"). Production
  is fine (the heartbeat always attaches handlers and its generation guard drops the
  stale settle), but any consumer that calls the probe thunk directly must attach a
  handler. Worth a line in the `createLiveSignal` docstring if the reconcile pass is
  touching it.
- `SurfaceFace.surface` is `Record<string, Record<string, unknown>>`, so a member
  lookup is `unknown` and every structural probe (`surfaceAppProbe`, S1's three
  reserved probes) narrows by hand. That is D2's deliberate trade; noting it only
  because surface-app now has the fourth such site.

---

## 8. Gate

```
pnpm --filter @kolu/surface-app typecheck   → ZERO errors
pnpm --filter @kolu/surface-app test:unit   → 13 files, 166 tests, ALL GREEN
biome lint --error-on-warnings packages/surface-app → clean (40 files)
biome format --write packages/surface-app          → applied (scoped, see §6.4)
grep for `zod` / `@orpc` / `partysocket` VALUE imports across src/ → NONE
```

All 13 pre-existing test files survive with their laws intact. Test-count deltas:

| file | note |
|---|---|
| `connect.test.ts` | `retireOnStaleClose` describe → `isStaleProcessClose` (2) + `createSurfaceSocket` (4: the pid-echo re-dial, the 4001 one-dial-zero-redials app contract, the ordinary-drop re-dial, the private echo). `createHeartbeat` gains "never probes a RETIRED wire". |
| `surface.test.ts` | +4 byte-level fixture tests (encoded result, encoded input, decode, required-field negative); the contract-shape assertion became a `group.requests` key-set assertion (D1). |
| `server.test.ts` | +6 `serveSurfaceSocket` tests over a REAL client↔server round trip; the router-walk probe assertion became a handler-tag one. |
| `solid/lifecycle.test.ts` | the two `retireSocket` tests became "a RETIRED wire goes straight to `restarted`" + "a retirement before any identity is ignored"; +1 "probes a wire that was ALREADY open". |
| `solid/transportLive.test.ts` | same four laws, now over the REAL `createSurfaceSocket` → `websocketLink` path (no `vi.mock` of surface-app's own seam). |
| `solid/connectSurfaces.test.ts` | the heartbeat-target test now asserts the TAG on the wire (`"tag":"surface/a/system/live"`, and NOT the `b` sibling's) rather than an identity-free `{ surface }` wrapper; +1 empty-map fail-fast. |
| `src/fakeSocket.testlib.ts` | NEW (test-only): `FakeWebSocket` + `socketPair()` + `fakeWire()`. |

## 9. Nothing here invalidates a PLAN assumption

- **D5** holds on both legs: the browser leg is `websocketLink` with surface-app
  supplying the classifier (#5) and the echo thunk (#6c); the server leg keeps
  gate → enrol → dispatch (#6) in front of an Effect RPC server, hand-wired rather
  than turnkey — with ONE correction recorded in §4.2 (the synthetic-header path
  the plan sketched is unreachable on the socket-server protocol; per-connection
  services replace it).
- **D4** holds: a retired wire fails with `SurfaceTransportRetired`, which the face's
  positive-match fence refuses to retry — the property the deleted `send`-poisoning
  existed to fake.
- **#17** had nothing to translate here (no `.optional()`/`.default()`); the WIRE
  format got its byte fixtures anyway.
- No `package.json` `dependencies` block changed, so PLAN standing rule 5 does not
  fire for this package.
