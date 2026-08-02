# W2 Stage 4 — the wire transports (`links/*`, stdio + unix serving) on Effect RPC

Scope delivered: `src/links/wire.ts` (new — the successor of `_wire.ts`),
`src/links/{websocket,stdio,unix-socket}.ts`, `src/peer-server.ts`,
`src/unix-socket.ts`, `src/loopback.ts`, and their tests, plus two new suites
(`links/websocket.test.ts`, `links/byteSplice.test.ts`). `src/links/stdio-codec.ts`
(+ its test) and `src/links/_wire.ts` are DELETED. Nothing outside this list was
touched: the client face (`solid/*`, `client.ts`, `project.ts`,
`mirrorRemoteSurface.ts`, `links/direct.ts`) is Stage 3's, concurrently in flight.

---

## 1. Link shapes (the API every consumer re-wires against)

```ts
// links/wire.ts — package-internal, the ONE place a protocol layer becomes a dispatch
interface WireLink {
  readonly dispatch: SurfaceDispatch;   // branded half-open (../link.ts)
  dispose(): Promise<void>;             // releases the link's scope; idempotent
}

// links/stdio.ts
stdioLink(opts: { group: RpcGroup<Rpc.Any>; read: Readable; write: Writable })
  : Promise<WireLink>

// links/unix-socket.ts
unixSocketLink(opts: { group: RpcGroup<Rpc.Any>; socketPath: string })
  : Promise<WireLink>

// links/websocket.ts
websocketLink(opts: {
  group: RpcGroup<Rpc.Any>;
  url: () => string;                       // re-evaluated on EVERY (re)dial (#6c)
  isTerminalClose: (code: number) => boolean;  // REQUIRED (#5) — see §4
  connect?: (url: string) => WebSocket;    // platform binding; defaults to globalThis.WebSocket
}): Promise<WebsocketLink>                 // extends WireLink, WireTransport ({dispatch, wire})
```

Every link is now **async** (`stdioLink` and `websocketLink` were sync) — building
the protocol layer and its fibers is an effect, and `Effect.runSync` cannot run it.
Every link now returns a **`dispose`** (only `unixSocketLink` did) — the link owns a
`Scope` holding the protocol's dial/ping/response fibers, and dropping the value
without disposing leaks them.

`openWireLink` is the shared body: it builds the leg's protocol `Layer` into a
long-lived `Scope` (NOT `Effect.provide`, which would scope the transport to the
`RpcClient.make` call and tear it down instantly), makes
`RpcClient.make(group, { flatten: true })`, brands the result with
`brandHalfOpenDispatch`, and maps the transport failure channel into the leg's
error vocabulary. It installs **no retry** — PLAN D3/#12: the per-subscription
re-subscribe fence is the FACE's job, and a link that healed internally would hide
the failure the fence must see.

Error vocabulary per leg (D4):

| leg | transport failure becomes |
|---|---|
| stdio / unix socket | `SurfaceStdioTransportClosed` (always — the leg never reconnects) |
| websocket, retired | `SurfaceTransportRetired` |
| websocket, not retired | the raw `RpcClientError`, **untouched** — that is what the face's retry fence retries on |

A member's DECLARED tagged error and an undeclared DEFECT pass through unchanged;
only `RpcClientError` (and the one socket defect below) is rewritten.

## 2. Socket-from-Duplex — the verified mechanism

- **stdio (parent side)**: `Duplex.from({ readable: child.stdout, writable: child.stdin })`
  → `NodeSocket.fromDuplex(Effect.acquireRelease(…))` → `RpcClient.makeProtocolSocket`.
  `NodeSocket.fromDuplex` is in `@effect/platform-node-shared/NodeSocket`, re-exported
  by `@effect/platform-node/NodeSocket`. `Socket.fromTransformStreams` does not exist in
  beta.102 (`Socket.fromTransformStream`, web-streams-shaped, does — wrong tool here).
- **unix socket (client)**: an EXPLICIT `net.createConnection` dial, then the connected
  `net.Socket` (already a Duplex) through the same `duplexWireLink`. **Deviation from the
  brief's `NodeSocket.layerNet({path})`**, with a reason: `layerNet`'s socket is acquired
  lazily inside each protocol RUN, so a dead path would resolve `unixSocketLink`
  successfully and only fail at the first call — but every daemon probe in the tree
  (supervisor convergence, CLI discovery, the upgrade-window harness) reads a *connect
  rejection* as "nothing is serving here". The eager dial preserves that verdict, and
  `unix-socket.test.ts` pins it (`rejects … { code: "ENOENT" }`).
- **stdio (agent side, serving)**: `RpcServer.layerProtocolStdio` over a `Stdio` service
  built from the transport pair (`NodeStream.fromReadable` / `NodeSink.fromWritable`,
  mirroring `NodeStdio.layer`). Two deliberate departures: the inbound stream **swallows
  its own failure and ends** (Effect's stdio read loop retries a failing stdin forever at
  500 ms, which would spin against a destroyed stream), and `stderr` stays the process's.
- **unix socket (serving)**: per-connection serving over a **one-connection
  `SocketServer`** — see §5 for why `NodeSocketServer.layer` could not be used.

No `RpcSerialization` other than `layerNdjson` appears anywhere.

## 3. `serveOverStdio` — same contract, new mechanism

```ts
serveOverStdio(opts: {
  group: RpcGroup<Rpc.Any>;      // was: router
  handlers: SurfaceHandlers;     // was: router
  transport?: { read, write };   // unchanged
  onFirstRequest?: () => void;   // unchanged shape, see below
}): Promise<ServeOverStdioEnd>   // unchanged union
```

Preserved verbatim, all pinned by the ported `peer-server.test.ts` (9 tests) and
`peer-server.lifetime.test.ts` (4 tests, real child processes under
`KOLU_DAEMON_TESTS=1`):

- **never rejects**; `{reason:"end"}` on EOF / benign write death (EPIPE,
  ERR_STREAM_DESTROYED, including the shared-duplex shape), `{reason:"error", error}`
  on a read error / non-benign write failure — decided at ONE classification point;
- **stdout ownership**: no `transport` ⇒ the process IS the agent ⇒ `console.log`
  redirects to stderr and the framework exits the process after the promise settles
  (0 on end, 1 on error, behind `setImmediate` so post-settle sync work runs);
- **`{reason:"error"} ⇒ transport closed`** (the #1859 zombie): a throwing
  `onFirstRequest` now fails the inbound stream *before* the chunk it rode in on is
  dispatched, so the settled serve provably answers nothing (`handlerCalls === 0`);
- the async-`onFirstRequest` thenable guard.

`onFirstRequest` now fires on the first inbound BYTES rather than the first decoded
frame — the same "the link demonstrably works" signal, one layer lower (the decoded
frame stream is inside Effect's protocol and is not observable from here).

`serveOverUnixSocket` keeps every bind-time verdict and the ordered teardown
(`dir-not-private` / `already-served` / `probe-failed` / `not-a-socket` /
`bind-failed` / `listening`; close ⇒ stop accepting → destroy peers → unlink,
synchronously, idempotently). Its `log?: UnixSocketLogger` option is **removed** (the
runtime events it carried are inside Effect's socket handling now); `getRuntimeSocketPath`
is untouched.

## 4. The websocket seams

- **URL thunk (#6c)**: `opts.url()` is called inside the socket's `acquire`, and
  `Socket.fromWebSocket` acquires per RUN while the protocol RETRIES the run — so
  "re-evaluated on every re-dial" is structural, and pinned (`pid=1` → close → `pid=2`).
- **Terminal-close classifier (#5)**: `isTerminalClose` is a REQUIRED option, not a
  constant. `STALE_PROCESS_CLOSE_CODE` (4001) lives in `@kolu/surface-app`, which
  `@kolu/surface` may not import (the dependency arrow points the other way), and a link
  that guessed the code would be guessing about when to stop retrying. On a terminal
  close the link's own `close` listener (registered at construction, so it runs BEFORE
  Effect's) sets `retired`, which (a) HALTS the reconnect schedule and (b) rewrites every
  in-flight and future transport failure to `SurfaceTransportRetired`. Pinned: a 4001
  close ⇒ exactly one socket, zero re-dials, in-flight + future calls fail
  `SurfaceTransportRetired`; a 1006 close ⇒ a second dial.
- **The halting schedule**: `RpcClient.layerProtocolSocket` accepts no `retryPolicy`, so
  the link uses `RpcClient.makeProtocolSocket({ retryTransientErrors: true, retryPolicy })`
  under `Layer.effect(RpcClient.Protocol)`. The policy reproduces Effect's own default
  backoff (exponential 500 ms ×1.5, capped 5 s) and halts with `Cause.done` while
  `retired` — v4's `Schedule` has no `while`/`until` combinator, so this is
  `Schedule.fromStepWithMetadata`. The stdio/unix legs use the degenerate case of the same
  mechanism (`neverReconnect`: halt on the first failure — a re-dial would re-acquire the
  same dead fds).
- **`WatchableWire` (#4)**: `status()`/`onStatus()`/`forceReconnect()`. `forceReconnect`
  CLOSES the current socket (code 1000) rather than interrupting the protocol fiber:
  interruption would kill the transport, whereas a close makes the run fail and the
  schedule re-dial — which is the recycle the watchdog wants. Deviation from the brief's
  wording, same observable.

**Seam change adopted (Stage 3's, mid-stage)**: `WireStatus` gained `"retired"` and
`link.ts` gained `WireTransport { dispatch, wire }`. `websocketLink` now raises
`retired` INSTEAD of `closed` on a terminal close (a watchdog seeing `closed` would wait
for a reconnect that can never come) and `WebsocketLink extends WireLink, WireTransport`.
I made no changes to `link.ts` myself.

## 5. Deviations, with evidence

1. **`NodeSocketServer.layer({path})` is unusable for `serveOverUnixSocket`** — measured,
   not assumed. Its scope finalizer calls Node's `server.close()`, which does not complete
   until every established connection has ended; the accepted sockets are unreachable from
   outside the layer, so closing the listener's scope with a peer connected **deadlocks**
   (reproduced with a throwaway script: `Scope.close` never resolved and the peer was
   never destroyed, `destroyed=false` after 1 s). `serveOverUnixSocket` therefore keeps
   its own `net.createServer` + accepted-peer index (exactly the deleted design) and hands
   each accepted connection to the RPC server through a ~15-line **one-connection
   `SocketServer`** (`run` serves that socket, then parks — its `Effect<never,…>`
   contract). Per-connection scopes also mean one peer's teardown cannot touch another's.
   `unix-socket.test.ts` (19 tests) is green including the four teardown pins that were
   red on the deadlocking shape.
2. **`unixSocketLink` dials eagerly** — §2.
3. **`procedureErrors.test.ts` lost its `mirrorRemoteSurface` describe block** — that leg
   consumes the client face and `mirrorRemoteSurface`, both Stage 3's; it belongs with the
   mirror suite. The wire half (declared error typed across a real stdio wire, undeclared
   throw ⇒ defect, transport death ⇒ `SurfaceStdioTransportClosed`) is fully covered here.
   **Stage 3/5 should restore the mirror leg** in `mirrorRemoteSurface.test.ts`.
4. **The abort-propagation and stdout-corruption pins stayed in `links/stdio.test.ts`**
   (their existing home) rather than moving into `procedureErrors.test.ts`; abort
   propagation is now expressed as fiber interruption (interrupt the consumer ⇒ the
   server-side stream's `ensuring` runs), which is D10's replacement for `AbortSignal`.
5. **`peer-server.ts` keeps its filename and `@kolu/surface/peer-server` subpath** even
   though the oRPC "peer" protocol is gone. Renaming means moving the package export and
   every consumer import (kaval, padi, surface-remote, surface-map, examples) — W4 touches
   those files anyway. Flagged for W4/W5.
6. **`Effect.run*` at the link edge**: `openWireLink`, the link constructors,
   `serveOverStdio` and `serveOverUnixSocket` run effects at the Promise boundary, because
   the whole link/serve API is Promise-shaped for the Solid face and for daemon `main`s.
   These are transport edges; the #25 allowlist test (W6) should enumerate them.

## 6. The byte-splice proof (#10) — `links/byteSplice.test.ts`

Three tests, all on captured raw bytes:

1. a **stdio CLIENT spliced into a `serveOverUnixSocket` server** (the literal
   `frontDaemonOverStdio` shape: a `PassThrough` pair pumped verbatim into a `net.Socket`
   and back) carries both a unary call and a streaming member end to end;
2. a **unix-socket CLIENT spliced into a `serveOverStdio` server** does the same in the
   mirror direction;
3. the two legs frame the SAME call **character for character**: with only the per-call
   volatile values blanked (`id`, `traceId`, `spanId`) the first request line from each leg
   is identical, e.g.
   `{"_tag":"Request","id":<n>,"tag":"surface/math/double","payload":{"x":21},"traceId":"<trace>","spanId":"<span>","sampled":true,"headers":[]}`.

Every captured byte is asserted to be ndjson: no control byte other than the `\n`
delimiter (so no raw binary — the reason base64 existed), the stream ends on a delimiter,
and every line `JSON.parse`s. A member that ever put binary on the wire fails here rather
than corrupting a splice in production.

## 7. Gates

```
vitest run (owned files, KOLU_DAEMON_TESTS=1):
  links/stdio.test.ts        9   links/websocket.test.ts     8
  links/byteSplice.test.ts   3   peer-server.test.ts         9
  peer-server.lifetime.test.ts 4 unix-socket.test.ts        19
  procedureErrors.test.ts    4
  → 7 files, 56 tests, ALL GREEN  (the lifetime suite forks REAL child agents)

tsc --noEmit → ZERO errors in every file this stage owns.
biome lint --error-on-warnings (16 owned files) → clean.
biome format --write (16 owned files) → applied (scoped, not repo-wide, so the
  concurrently-edited Stage-3 files are not written under the sibling agent).
No `zod` / `@orpc/*` import remains in any owned file; `stdio-codec.ts` and
  `_wire.ts` are deleted, with no reference left anywhere in the tree.
```

**Excluded from the run (Stage 3, in flight — red before and after this stage):**
`solid/*` (`surfaceClient.{health,policy,readonly}.test.ts`,
`collectionDeltasGate.test.ts`, `createLiveSignal.test.ts`,
`createReactiveSubscription.test.ts`, `keyedSubscriptionCache.test.ts`),
`project.test.ts`, `mirrorRemoteSurface.{ts,test.ts}`, `mirrorPumpOwnership.test.ts`,
`links/direct.test.ts`. Note S2's report assigned `links/direct.test.ts` to Stage 4
while this stage's brief assigns `links/direct.ts` to Stage 3 — I left both to Stage 3,
since the test can only be written against their dispatcher.

## 8. API-break list additions (drishti / odu follow-up)

1. `stdioLink(opts)` / `websocketLink(opts)` are **async** and take an options OBJECT
   including the surface's `group`; all three wire links return `{ dispatch, dispose }`
   instead of a typed oRPC client. `websocketLink` additionally returns `wire`.
2. `websocketLink` no longer accepts a `WebSocket` — it DIALS, from a `url` thunk, and
   REQUIRES an `isTerminalClose` classifier. partysocket is gone from the surface.
3. `unixSocketLink` returns `{ dispatch, dispose }` (was `{ client, dispose }`), and
   `dispose()` is now async.
4. `serveOverStdio({ router })` → `serveOverStdio({ group, handlers })`.
5. `serveOverUnixSocket({ router, log })` → `serveOverUnixSocket({ group, handlers })`;
   `UnixSocketLogger` is deleted.
6. `LinkStdioClient`, `StdioRPCLink`, `StdioRPCLinkOptions` are deleted (oRPC internals);
   `StdioLinkOptions` survives with a `group` field added.
7. `peer-server.lifetime.contract.ts` now exports `lifetimeSurface` +
   `LIFETIME_PING_TAG`/`LIFETIME_TICK_TAG` (was the oRPC `lifetimeContract`). Test-only,
   but `unix-socket.test.ts` and the fixture import it.
8. Nothing in `package.json` changed (no `dependencies` edit ⇒ PLAN standing rule 5 does
   not fire for this stage); the `./links/*`, `./peer-server`, `./unix-socket`,
   `./loopback` subpaths keep their names.

## 9. Nothing here invalidates a PLAN assumption — with three precise notes

- **D5 holds** for the browser leg, with the three review-mandated seams implemented and
  tested. `layerProtocolSocket`'s option surface is narrower than the plan implied (no
  `retryPolicy`), so the link uses `makeProtocolSocket` + `Layer.effect(Protocol)`.
- **D5's unix-socket serving line (`NodeSocketServer.layer({path})`) is wrong in
  beta.102** for a host that must be able to CLOSE a listener with peers attached — §5.1.
  This is the one genuine platform gap found; the workaround is local and small, but W4's
  daemon work should not reach for `NodeSocketServer.layer` either.
- **#10 is now evidence, not assertion** (§6), and its binary half is closed: nothing on
  the wire is non-JSON-safe.
- **#12 is honoured**: no link retries a call. The stdio/unix legs do not even reconnect
  the transport, matching their documented "one stream pair, one life" contract.
