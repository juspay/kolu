# W4 — `kolu-server` on Effect: the transport mount, the widening seam, the conf store

Scope delivered: `packages/server/**` (every source and test file that touched
`zod` / `@orpc/*`, plus everything the W2/W3 framework breaks reddened), ONE
additive edit to `@kolu/surface-remote` (the recorded `dispatch` need), and ONE
additive schema arm in `kolu-common` (§7.2). Zero `zod` / `@orpc/*` imports remain
in `packages/server/src`.

---

## 1. The mount (PLAN D5 · review #6 · #15)

### 1.1 What the browser sees — the W5 hand-off in one block

| fact | value |
|---|---|
| RPC URL | `ws://<host>/rpc/ws` (+ `?pid=<serverProcessId>` echo) — **unchanged** |
| serialization | ndjson, one frame per line (`RpcSerialization.layerNdjson`) |
| transport count | **ONE.** The `/rpc/*` HTTP arm is DELETED — see §1.4 |
| upgrade gate order | CSWSH origin → ws upgrade → stale-tab gate → reaper enrol → RPC dispatch |
| stale-tab close | code `4001` (`STALE_PROCESS_CLOSE_CODE`), reason `"stale server process"`, sent BEFORE any RPC frame |
| ordinary close | whatever the peer/reaper sends; the client re-dials (surface-app's `isTerminalClose` is the only classifier) |
| liveness | server pings every 30 s and `terminate()`s a socket that missed a pong |
| per-caller facts | `viewerAddress` + `forwardedFor`, provided as a **per-connection service**, not headers |

### 1.2 The seam, as wired

```
node http(s) server                       (hono still owns the HTTP app — §1.5)
  └─ server.on("upgrade")                 kolu-server's own handler
       ├─ gateWsOrigin(...)               CSWSH: reject before a socket exists
       └─ wss.handleUpgrade(...)          ws.WebSocketServer({ noServer: true })
            └─ acceptor.accept(ws, url, onAccepted)     @kolu/surface-app/server
                 ├─ gateStaleSocket       close 4001, never enrol, never dispatch
                 ├─ heartbeat.register    the ping/terminate reaper
                 └─ onAccepted() →  serveSurfaceSocket({
                                       group:    servedGroup,
                                       handlers: servedHandlers,
                                       socket:   ws,
                                       services: Layer.succeed(CurrentViewer)({…}),
                                     })
```

`serveSurfaceSocket` (surface-app, W2 §4) stands up a **per-connection,
Layer-composed `RpcServer`** over the SHARED handler record: `RpcServer.layer(group)`
← `group.toLayer(handlers)` ← `layerProtocolSocketServer` ← `layerNdjson` ← a
one-connection `SocketServer` over the accepted websocket. One peer's teardown
cannot touch another's, and its `done` is observed (`connLog.error`) rather than
floated — an ignored rejection would reach the process-level `unhandledRejection`
boundary and take the whole server down over ONE dead socket.

### 1.3 Two deviations from the brief, both forced, both evidenced

**(a) `RpcServer.toHttpEffectWebsocket` + a synthetic `remoteAddress` header is
NOT the mechanism. The per-connection SERVICE is.**

The brief (following PLAN D5/#15) called for injecting
`HttpServerRequest.remoteAddress` as a synthetic header before `onSocket`, so a
`CurrentViewer` `RpcMiddleware` could read it. That path is real but unreachable
here, for a reason surface-app measured in W2 (§4.2) and this wave re-confirmed
against beta.102:

- `makeProtocolWithHttpEffectWebsocket` obtains its socket via
  `request.upgrade` — and `@effect/platform-node`'s `makeUpgradeHandler` wraps the
  `ws` socket in `Socket.fromWebSocket` and never exposes it
  (`NodeHttpServer.js`: `Socket.fromWebSocket(… wss.handleUpgrade(…) …)`).
  The raw `ws` socket is what **all three** pre-dispatch steps need:
  `gateStaleSocket` calls `ws.close(4001, …)`, `startWsHeartbeat` calls
  `ws.ping()` / `ws.terminate()`, and both read `readyState`. Taking that path
  would have meant deleting the kolu#1231 gate and the half-open reaper — the two
  things review #6 exists to protect.
- On the socket-server protocol the header channel simply does not exist:
  `makeProtocolSocketServer` calls `server.run(onSocket)` with the socket ALONE;
  `headers` is reachable only from the effect-http upgrade route.

So the per-caller fact rides a **`Layer`**, which is strictly better than a
synthetic header: it is typed, it cannot be spoofed by a client sending the same
header name, and it is scoped to exactly one connection. `CurrentViewer` is a
`Context.Service` in `router.ts`; `hosts/viewer` reads it with `CurrentViewer.use`.
`RpcGroup.toHandlers` captures `Effect.context()` at layer build and provides it to
every handler, so the requirement is genuinely satisfied per connection (verified
by `viewerHostRoute.test.ts`, which provides the layer and drives the handler).

**(b) hono is still the HTTP app. `effect/unstable/http` + `NodeHttpServer` are
NOT used, and that is a scope boundary, not an oversight.**

Everything oRPC is gone. The HTTP app is not, because three of its five mounts are
Hono-typed functions in packages this wave does not own:

| mount | owner | shape |
|---|---|---|
| `installFreshStatic` (SPA shell, `/sw.js`, precompressed `/assets/*`, the kolu#1319 stale-stamp guard) | `@kolu/surface-app` | `(app: Hono, opts) => void` |
| `installPwaManifest` | `@kolu/surface-app` | `(app: Hono, manifest) => void` |
| `mountArtifactSdk` (bundle route + the text/html `<script>` splice) | `@kolu/artifact-sdk` | `(app: Hono, opts) => void` |

Porting them is a public-API change to a drishti-shared package (`.claude/rules/surface.md`),
and re-implementing them inside kolu-server would duplicate the freshness contract
the repo deliberately owns in one place. Running BOTH stacks in one process would
be the dual path locked decision 5 forbids. **The residual is named here for W6:**
convert `installFreshStatic` / `installPwaManifest` / `mountArtifactSdk` to
`HttpRouter` routes, then kolu-server's `serve()` becomes `NodeHttpServer` and the
`hono` / `@hono/node-server` / `hono-pino` deps drop. The ws seam above needs no
change when that happens — it already owns its own upgrade off the node server.

Consequence kept honest: `pinoLogger` (hono-pino) still logs HTTP requests at
debug. The oRPC `LoggingHandlerPlugin` is deleted; RPC-level logging is now the
per-connection `connLog` (connect / disconnect with code + reason + remaining
count) plus `serving.done`'s error arm. The pino logger object remains the sink.

### 1.4 The `/rpc/*` HTTP arm is DELETED, deliberately

oRPC served every procedure on a second request/response transport. Effect RPC has
no such arm in this stack — a cell subscription, a collection delta stream and an
imperative procedure all ride the one ndjson socket, which is the only transport
kolu's own UI ever used ("kolu's own UI never uses this transport", the deleted
comment). Keeping an empty `/rpc/*` route would advertise a transport that answers
nothing. Same call the surface examples made in W2 (`surface-examples-report.md` §3).

**Security note, in kolu's favour:** `gateHttpRpcOrigin` existed because oRPC's
HTTP codec deserialized a cross-site `multipart/form-data` POST straight into
procedure input with no preflight. Deleting the transport removes that attack
surface outright rather than gating it. `gateWsOrigin` is untouched and still
load-bearing. **`gateHttpRpcOrigin` now has ZERO call sites in the repo** — W6
should shed it from `@kolu/surface/ws-origin` (surface-examples recorded the same
finding; this wave closes the last consumer).

### 1.5 Preserved verbatim

- the `booted` single-call guard;
- the process-level fatal boundary — `uncaughtException` and `unhandledRejection`
  → `log.fatal` → `process.exit(1)`; SIGTERM/SIGINT/SIGHUP → release the supervisor
  gate → `exit(0)`;
- `resolveTlsOptions` + the https `createServer` option and host/port binding;
- the local-supervisor claim, the fail-open local `pin()`, the default-vs-guest
  re-serve pump disposition (default pump death is fatal; a guest's retires the host);
- `installRouteErrorLogging`, the iframe preview route (raw-target selection,
  `..`/`%2f` guards, the 503/404/400 arms), `/api/health`, the PWA manifest, static.

---

## 2. The widening seam (`surface.ts`) — one group, one assert, one merge

The oRPC original built `servedContract = oc.router({...contract, surface: {…, padi:
padiHostMap.surfaceContract}})` and re-adapted the assembled router through
`implement(servedContract)`, because `implement(C).router(obj)` silently DROPS keys
`C` does not declare — the boot-time 404 `router.test.ts` was written for.

Under a flat tag namespace there is nothing to re-adapt. The successor is:

```ts
export const servedGroup = koluRootGroup.merge(koluSurfaceGroup, padiHostMap.group)
// asserted at IMPORT: requests.size === root + koluSurfaces + padiMap
```

**Deviation from common's hand-off, with the reason.** `common-report.md` §6 said to
merge `composeSurfaceContracts(surfacesWithPadi).group`. That would collide: the
plain `padi` sibling and the host MAP describe the same `surface/padi/<member>/<verb>`
tags with different payloads (the map folds every member behind a `{mapKey, input}`
envelope), and `merge` is last-writer-wins with no detection — so one spelling of
every shared tag would vanish silently AND the plain sibling's three reserved
`surface/padi/system/*` tags would be left ADVERTISED with nothing bound. The oRPC
code expressed this as an OVERWRITE of the `padi` key; a flat merge cannot. So the
padi half enters ONCE, as the map, and the two remaining halves (`koluRootGroup`,
the padi-LESS `koluSurfaceGroup`) are provably disjoint from it — proved by the
count, not assumed. `router.test.ts` pins `surface/padi/system/live` ABSENT for
exactly this reason.

The boot-time twin is `assembleServedHandlers({kolu, padiMap, root})`: it merges the
three fragments' handler records (null-prototype) and asserts route-set identity in
BOTH directions — an advertised tag with no handler (the silent 404) and a handler at
an unminted tag (dead code) each crash the boot. Fatal disposition preserved:
`koluSurfaces.done.catch → log.fatal → process.exit(1)`. The reactor cadences
(`everyMsOr(MEMORY_SAMPLE_INTERVAL_MS | DAEMON_INVENTORY_SAMPLE_INTERVAL_MS |
FORWARD_REAP_INTERVAL_MS, …)`), the two `scan`s over the shared `onState` source, the
`confStore` cells and the seed invariant are all untouched. `implementSurfacesOnPublisher`
still runs on padi's SHARED publisher.

`forwards.create` / `forwards.cancel` became `({input}) => Effect.promise(…)`: neither
declares an `error` on the spec, so a rejection is an UNDECLARED fault ⇒ a DEFECT
(D4). The RPC server sends a `Defect` frame; it does not kill the serving stack
(verified in `RpcServer.js` — `sendDefect`, not a fatal).

---

## 3. `router.ts` — root procedures as a fragment

`buildAppRouter(deps)` returns `{ group: koluRootGroup, handlers }` — seven handlers
keyed by their own wire tags. No nesting, no re-adaptation, no `t` builder. The one
cast is documented: `SurfaceHandlers` erases handler REQUIREMENTS, and `hosts/viewer`
genuinely requires `CurrentViewer`, which is satisfied per connection by the layer
the mount hands `serveSurfaceSocket` — a fact that cannot appear in a
process-lifetime record's type.

`CurrentViewer` is exported from `router.ts` (`Context.Service<CurrentViewer, {viewerAddress, forwardedFor}>()("kolu-server/CurrentViewer")`).
Both facts are still passed on, still unflattened (`undefined` ≠ `""`), and the
believe-which judgment still lives in `portForward/resolveViewerHost.ts`.

---

## 4. `state.ts` — the DISK format (PLAN #17)

`PersistedStateSchema` is a `Schema.Struct` over the (now Effect)
`PreferencesSchema` / `PersistedHostsSchema` / `ViewerModeSchema`. It stays
UNEXPORTED (`.claude/rules/state.md`). `SCHEMA_VERSION = "1.36.0"` and every rung of
the conf ladder — including the 1.31.0 backup-first burial and the three exported
migration bodies — are byte-identical; the ladder never decodes, it reshapes raw
stored JSON.

- boot validation: `PersistedStateSchema.safeParse` → a module-scope
  `Schema.decodeUnknownResult`, `Result.isFailure` → the same `log.error` with the
  same sentence. Effect's `SchemaError` renders path-annotated, so the ONE string
  carries what zod's hand-built `issues.map(…)` summary spelled.
- `hostPersistence.ts`: `PersistedHostsSchema.safeParse` → the same compiled
  `decodeUnknownResult`, still a BRANCH whose failure arm THROWS naming the store
  (never normalizes, never empties the fleet). `getPersistedHosts` now returns
  `readonly string[]` (Effect decodes are readonly).
- `PersistedState` (the `Conf` type parameter) is the MUTABLE projection of
  `Schema.Type`, because `Conf.set` indexes a mutable record and the ladder writes
  whole domain values back.

**#17's explicit-`undefined` strip has NO site on this format, and that is proved
rather than asserted:** every field of the disk shape is REQUIRED — the three
top-level keys, all ten `Preferences` fields, both `rightPanel` fields. The new
fixture reflects over `PreferencesSchema.fields` and asserts zero optional keys,
with a NON-VACUOUS control (the same probe over `PreferencesPatchSchema`, the one
place the repo does use `optionalKey`, reports > 0). Add an `optionalKey` to the
persisted shape and that test fails, pointing at the strip that then becomes
necessary.

### 4.1 Fixture inventory — `src/stateByteCompat.test.ts` (NEW, 7 tests)

| fixture | pins |
|---|---|
| fresh install | the EXACT `state.json` bytes conf writes for the default state — tab indentation, key order, `hosts: []`, `viewerMode: "dark"` — read off a real `Conf` under a temp dir, not a schema round trip |
| populated state | each domain value decodes AND re-encodes to the same bytes it was read as; `hosts` as `["remote:zest","remote:srid@box"]`; `viewerMode` as `"light"` |
| negative | a `preferences` missing a required field is REJECTED; a hand-edited `hosts: ["local"]` still fails loud |
| 1.30-era blob | the retired `shuffleTheme` + pre-1.32 `rightPanel.collapsed` + pre-1.34 `activityAlerts`, walked through all three ladder bodies: exact output bytes, and the result DECODES under the live `PreferencesSchema` (#1237's class of failure, now a unit failure) |
| 1.32-era blob | the pre-rename `activityAlerts` walked through 1.34: exact bytes + decodable |
| 1.34-era blob | the ladder is a byte no-op on a current record |
| #17 probe | zero optional keys on the disk shape (with the non-vacuous control), and an explicit `undefined` value REJECTED |

**One pre-existing ladder bug found and RECORDED, not fixed.** Walking a pre-1.30
blob through the real rung order, the 1.32 step spreads today's
`DEFAULT_PREFERENCES` (which already carries `attentionAlerts: true`), so by the
time the 1.34 rename runs the record LOOKS already-migrated and DROPS the legacy
`activityAlerts: false` instead of carrying it forward — a pre-1.30 install
re-enables attention alerts on upgrade. That is the shipped zod-era behaviour
byte-for-byte; this migration must not change it, so the fixture pins it as observed
with the reasoning in place. `state.test.ts` still pins that the 1.34 rename walked
ALONE does carry the OFF value. **A deliberate fix is its own change with its own
ladder rung** — flagged for whoever owns preferences next.

---

## 5. Everything else in the package

| file | change |
|---|---|
| `iframePreviewRoute.ts` | `z.infer<typeof PadiPreviewReadOutputSchema>` → `typeof …Schema.Type`; nothing else (the streaming/range/ETag machinery is untouched) |
| `index.ts` | `directLink` → `directDispatch`; `serveHostMap`'s `linkFor` → `dispatchFor` (cast-free now); `reServe.router` → the `{group,handlers}` pair; `HostKeySchema.parse` → `decodeHostKeyValue`; the memory read is `Stream.runHead` (fiber interruption replaces the `AbortController`) |
| `portForward/hostPorts.ts` | `CollectionFace` (still oRPC-shaped in `@kolu/surface`) replaced by a local `TerminalsFace` stating the two READ verbs as BIVARIANT methods over `Stream`; one `iterateWithSignal` bridge adapts a member `Stream` to the AsyncIterable the framework's `firstFrameOfCollectionItem` (#1681's guard) still takes — the reader is REUSED, not reimplemented |
| `padi/newTerminalPolicy.ts` | the session's client is `unknown` + a checked `policyWriter` narrow that THROWS on a face with no `newTerminalPolicy.set` (the surface READ face types no write verb; a silent skip would be the wrong-client mistake made invisible) |
| `padi/padiConvergence.ts`, `padi/padiBinding.ts` | `client.surface.control.core.<verb>` → `client.control.surface.core.<verb>` (a sibling is a tag prefix now) |
| `padi/remotePadiBinding.ts` | `sshConnector<PadiDaemonContract>` → `sshConnector({surface: {...padiSurfaceSibling, group: padiDaemonGroup}, …})`; the COMBINED client is `padiClientOver(conn.dispatch)` (§6); `probeDaemonIdentityFrom` gets the control face re-nested under `control`, exactly as the framework's own `probeDaemonIdentity` does |
| `seal.test.ts` | the root-namespace seal reads a tag's first segment off `contract.requests` instead of object keys |
| `router.test.ts` | rewritten: the `StandardRPCMatcher` tree pins become tag-superset + route-set-identity pins (§2) |
| `portForward/viewerHostRoute.test.ts`, `padi/padiBinding.test.ts` | `createRouterClient` → direct dispatch over the runtime handlers (`handlers["hosts/viewer"](…)` + the `CurrentViewer` layer; `buildSurfaceFace(surface, directDispatch(reServed))`) |
| `padi/remotePadiBinding.test.ts` | the fake daemon now supplies a `dispatch` built by the framework's own `directDispatch` over handlers bound at the REAL wire tags — a fake DAEMON rather than a fake CLIENT. The retired `marker: "padi-scoped"` proof became a member-set proof (padi's members present, the control core's `core` absent) |
| `portForward/hostPorts.test.ts` | fakes return `Stream`s |

---

## 6. The `@kolu/surface-remote` additive edit (padi-A's recorded need)

Three fields, all additive, no signature broken:

```ts
interface Connection<Client> { …; dispatch?: SurfaceDispatch }          // session.ts
interface Session<…>        { …; currentDispatch?(): SurfaceDispatch | undefined }
interface AgentDial         { …; dispatch?: SurfaceDispatch }           // dialAgentOnce.ts
```

`sshConnector` sets `dispatch: link.dispatch`; `makeSession` implements
`currentDispatch()` off the live connection; `dialAgentOnce` reads it at hand-back.
Everything is OPTIONAL because a dispatch is a property of the TRANSPORT, not of the
role — an in-process endpoint connector has a client with no wire behind it and must
stay a valid `Connection`, and the existing test fakes stand in for the connector.
A consumer that genuinely needs the second face treats `undefined` as the loud error
it is (both consumers in this wave do).

**It is already load-bearing:** `remotePadiBinding.ts` now builds BOTH padi faces
with `padiClientOver(conn.dispatch)` — which is what let the remote binder keep its
control-core probe/drain at all after `sshConnector` went one-surface. padi's
`dial.ts` note ("if `AgentDial`/`Connection` ever carries `dispatch`, swap the probe
for `padiClientOver(dial.dispatch).control.surface.core.hello()`") is now actionable;
this wave did not take it (packages/padi is off-limits) — **hand-off to whoever owns
padi next.**

Gates: `pnpm --filter @kolu/surface-remote typecheck` → ZERO errors;
`test:unit` → 30 files, 287 passed / 2 skipped, ALL GREEN (the pre-existing count).

---

## 7. Cross-package edits, declared loudly

### 7.1 None to `packages/padi` — the sibling agent's tree is untouched.

### 7.2 ONE additive arm in `kolu-common` — `PadiConvergenceSchema`

`surface-daemon-supervisor`'s `UnconvergedCause` gained the D6/#3
`unspeakable-protocol` arm (`{socketPath, gatePath, pid}`). `PadiConvergenceSchema`
re-derives the framework shape verbatim ("Framework anomaly rides the wire as-is …
No converter" — `padiBinding.ts`), so kolu-server could not typecheck without it.
Added with its own docstring; `kolu-common` typecheck + 96 tests still green. **This
is a WIRE union gaining an arm** — a W5 client that switches exhaustively on
`convergence.cause` must handle it, and the skew card should show the typed
evidence (which socket, which gate, which pid) rather than only `detail`.

### 7.3 No `package.json` changed

Every dependency the rewrite needs (`effect`, `@effect/platform-node`) was already
declared, so **PLAN standing rule 5 does not fire** and `nix/workspace.nix:178`
needs no refresh. `zod` and the five `@orpc/*` entries are now UNUSED but still
declared — W6 owns the purge (removing them here would fire rule 5 for no benefit,
and `@orpc/client` / `@orpc/experimental-publisher` were already dead).

---

## 8. Gates

```
pnpm --filter kolu-server typecheck                → ZERO errors
pnpm --filter kolu-server test:unit                → 31 files, 318 passed / 12 skipped, ALL GREEN
pnpm --filter @kolu/surface-remote typecheck       → ZERO errors
pnpm --filter @kolu/surface-remote test:unit       → 30 files, 287 passed / 2 skipped, ALL GREEN
pnpm --filter kolu-common typecheck                → ZERO errors
pnpm --filter kolu-common test:unit                → 7 files, 96 passed, ALL GREEN
biome lint --error-on-warnings  packages/server packages/surface-remote/src
                                packages/common/src/surface.ts        → clean (122 files)
biome format --write  (scoped to the owned paths)                     → applied
grep 'from "zod"' / '@orpc' across packages/server/src                → ZERO
nix eval .#padi.drvPath   --no-warn-dirty                             → OK (§9)
nix eval .#kaval.drvPath  --no-warn-dirty                             → OK (§9)
```

Formatting was scoped, not `just fmt` repo-wide: a concurrent agent is editing
`packages/client` and the four TUI/CLI packages in this worktree (W5), and a
repo-wide write would touch their in-flight files. Same call every W2/W3 agent made.

---

## 9. `default.nix` stableLeaves (#23)

No `package.json` `dependencies` block changed in any package, so no closure edge
moved. Both daemon closures still evaluate — recorded in §8. See the run log in the
commit message for the exact verdicts.

---

## 10. Hand-offs

### To W5 (client)

1. **The wire URL and framing are unchanged**: `ws://<host>/rpc/ws?pid=<echo>`,
   ndjson, one socket. `wsBaseUrl` in `client/src/wire.ts` needs no edit.
2. **There is NO HTTP RPC transport.** A client that falls back to `POST /rpc/*`
   gets a 404 (or the SPA shell). Nothing did; noted so nothing starts to.
3. **Close-code semantics**: `4001` is terminal (the server closed a tab bound to a
   previous process; surface-app's link stops the retry schedule and fails every
   in-flight and future call with `SurfaceTransportRetired`). Every other code is an
   ordinary drop the link re-dials through, re-evaluating the `?pid=` thunk.
4. **The served tag set** is `servedGroup` — root tags (`server/info`,
   `daemon/restart`, `hosts/{viewer,add,remove,reconnect,renewDaemon}`),
   `surface/kolu/*`, `surface/surfaceApp/*`, and the padi MAP's `surface/padi/*`
   (folded members + `entries/{keys,get}`). The three reserved
   `surface/padi/system/*` tags are NOT served — the map is not a surface. A client
   that probes padi liveness must use the map entry's `connection` payload, not a
   `system/live` round trip on that prefix.
5. `PadiConvergence` gained the `unspeakable-protocol` cause (§7.2).

### To W6 (purge & polish)

1. Remove `zod` + the five `@orpc/*` entries from `packages/server/package.json`
   (then refresh `nix/workspace.nix:178` and re-check `default.nix` stableLeaves).
2. **`gateHttpRpcOrigin` has zero call sites repo-wide** — shed it from
   `@kolu/surface/ws-origin` (its tests go with it).
3. **`@kolu/surface`'s `collectionFace.ts` is dead** — its `Promise<AsyncIterable>` +
   `{signal}` shape describes no client after W2. `kolu-server` was its last
   consumer. Delete it, or re-declare it on `Stream` and re-point `hostPorts.ts`.
4. `firstFrame.ts` (`firstFrameOrUndefined` / `firstFrameOrThrow` /
   `firstFrameOfCollectionItem`) is still AsyncIterable-shaped. It is still CORRECT
   and still the one home of #1681's guard, but every consumer now bridges a
   `Stream` into it. A Stream-native successor would delete one bridge per site.
5. The hono → `effect/unstable/http` port (§1.3b): three installers in two packages,
   then kolu-server's `serve()` becomes `NodeHttpServer` and three deps drop.
6. `Effect.run*` allowlist (#25) — kolu-server's sites: `index.ts`'s
   `readPadiMemoryOnce` (the reactor's poll dep is `() => Promise<T>` and the reactor
   is deliberately non-Effect), and `portForward/hostPorts.ts`'s `iterateWithSignal`
   via `Stream.toAsyncIterable`. Both are true boundary edges.

### To whoever owns preferences

The 1.32-spreads-defaults / 1.34-rename interaction (§4.1) silently re-enables
attention alerts for a pre-1.30 upgrade. Pinned as observed; a fix needs its own
rung and its own `SCHEMA_VERSION` bump.

---

## 11. Nothing here invalidates a PLAN assumption — with two corrections recorded

- **D5 / #6** hold in full: the CSWSH gate, the stale-tab gate, the reaper and the
  RPC dispatch run in the required order, in front of a hand-wired (never turnkey)
  Effect RPC server. The correction is the MECHANISM: the raw `ws` upgrade is kept
  precisely because Effect's own upgrade path wraps the socket away from all three
  gates.
- **#15** is answered, by a per-connection `Layer` rather than a synthetic header —
  the header channel does not exist on the socket-server protocol (§1.3a). The
  observable (`hosts/viewer` answers per caller, from both the peer address and the
  forwarded header) is unchanged.
- **D1 / #16** are closed by construction (the padi half enters once, as the map)
  AND by assertion (an import-time count + a boot-time route-set identity check).
- **#17** is applied; its strip has no site on this format, and that is now a test.
- **D9's fault dispositions** are unchanged and still distinct: kolu-server is
  FATAL (the surface runtime's `done`, the default re-serve pump's `done`, the
  process-level boundary all `log.fatal` → `exit(1)`), padi/kaval loud-not-fatal.
- **D10** is honoured: `Effect.run*` appears at two genuine boundary edges (§10.6),
  and the RPC/http serving stack itself is Layer-composed. The boot stays an orderly
  async function, as locked decision 1 permits.
