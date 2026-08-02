> **Note on the guard rails already in place:** the repo has an explicit, heavily-commented rule that app code must NOT touch `@orpc/*` directly — see `packages/client/src/kaval/useDaemonRestart.ts:18` ("`@kolu/surface/solid` re-export, never from `@orpc/client` directly") and `packages/kaval/src/ptyHostSurface.ts:33`. The direct oRPC surface outside the framework is therefore already **small and well-bounded**. This is good news for an Effect migration: the blast radius is concentrated.

---

# oRPC usage OUTSIDE the surface framework packages

## Executive summary

**28 non-test files + 9 test files** outside `surface*` touch `@orpc/*`. They cluster into exactly **five** usage kinds:

| Kind | Where | Count | Migration character |
|---|---|---|---|
| `ORPCError` as the throw/catch vocabulary | padi (7), client (2), xterm-kit (1), kaval (2) | 12 files | **mechanical** — one error type, `instanceof` + `.code` checks |
| Contract composition (`oc.router` / `implement`) | common, kaval, server | 3 files | **needs design** — 3 spots, each with `as any` casts |
| Transport handlers (`RPCHandler` fetch/ws + pino plugin) | server/src/index.ts only | 1 file | **needs design** — the single HTTP/WS mount |
| Publisher pub/sub (`MemoryPublisher`) | padi/src/publisher.ts only | 1 file | **mechanical-ish** — one instance, one hand-rolled channel |
| Router / client **types** only (`Router`, `ContractRouterClient`, `ClientRetryPluginContext`) | kaval, padi, server | 4 files | **mechanical** — type-level plumbing, mostly `Router<any, any>` |

**Nothing outside the framework uses:** oRPC middleware, `.use()`, oRPC error-map middleware, `eventIterator`, `EventPublisher` beyond the one `MemoryPublisher`, or oRPC's own context propagation (context is passed once, from the transport mount, at `server/src/index.ts:889` and `:1192`).

**Layering verdict:** consumers overwhelmingly go through the framework, not through oRPC. `kaval-tui`, `padi-tui`, `kolu-mcp`, `kolu-cli` have **zero** `@orpc` imports (verified in both `src/` and `package.json`). The client's only oRPC contact is `ORPCError` for `.code` narrowing; everything else is `@kolu/surface-app/solid`, `@kolu/surface-map/client`, `@kolu/surface/solid`.

---

## Per-package detail

### `packages/common` (`kolu-common`) — difficulty: **needs design (small)**

Declares `@orpc/contract` only.

- **`src/contract.ts:19`** — `import { oc } from "@orpc/contract"`. The single raw-contract file.
  - `:48` `export const contract = oc.router({ ... })`
  - `:66` `...composeSurfaceContracts(surfaces)` — the framework's own composition spread into a raw `oc.router`. **This is the seam where framework and raw oRPC meet.**
  - `:68` `server.info` → `oc.output(ServerInfoSchema)` (no input)
  - `:79` `daemon.restart` → `oc.output(z.void())`
  - `:101` `hosts.viewer` → output `{ host: HostKey | null }` — deliberately a *root* RPC because the answer is **per-caller** (reads the connection's `viewerAddress`), which a broadcast surface cell cannot express. **This is the one place oRPC's per-request context is load-bearing.**
  - `:106` `hosts.add`, `:110` `hosts.remove`, `:120` `hosts.reconnect`, `:130` `hosts.renewDaemon` — all `oc.input(...).output(z.void())`.
- **`src/surface.ts:830`** — `koluSurface = defineSurfaceWithPolicy<ToastOnlyPolicy>()({...})`; ~8 cells (`preferences`, `viewerMode`, `daemonInventory`, `processMemory`, `padiLink`, `processStartedAt`, `portForwards`, …) + `procedures.forwards.{create,cancel}`. `:1007` `export const surfaces = { kolu, surfaceApp }`. **No oRPC import** — pure framework.
- **`src/surfacesWithPadi.ts:201`** — `padiHostMap = defineSurfaceMap({...})`, `:62` `PADI_SURFACE_NAME`, `:141` `PadiEntryFailureSchema`. **No oRPC import.**

Only 5 raw procedures survive on the whole app contract; everything else is surface-declared.

---

### `packages/kaval` — difficulty: **mostly mechanical, one needs-design spot**

Declares `@orpc/contract` + `@orpc/server`.

- **`src/ptyHostSurface.ts`** — the pty-host wire contract. `:55` imports only `defineSurface`/`SurfaceTypes` from `@kolu/surface/define` — **no oRPC import** (the header at `:33` says so explicitly). `:192 PTY_HOST_CONTRACT_VERSION = "6.0"`. `:453` `defineSurface({ streams: {...}, procedures: {...} })` — 7 streams (`terminalAttach`, `cwd`, `title`, `commandRun`, `foreground`, `exit`, `inventory`, `activity`) + `terminal.*` (spawn/kill/killAll/write/resize/list/getScreenState/getScreenText/getHistory) + `system.{version,heartbeat,info}`.
- **`src/inProcessPtyHost.ts:34-35`** — `import type { ContractRouterClient } from "@orpc/contract"` and `import { ORPCError, type Router } from "@orpc/server"`.
  - `:73` `export type PtyHostClient = ContractRouterClient<typeof ptyHostSurface.contract>` — **the client type is oRPC-derived**.
  - `:125 servePtyHost(deps)` → `implementSurface(ptyHostSurface, {...})` at `:181`.
  - `ORPCError` throws at `:141` (`NOT_FOUND` no PTY) and `:342` (`BAD_REQUEST` argv empty).
  - `:500 createInProcessPtyHost` returns `servedRouter: Router<any, any>` (`:502-503`, `:521` — biome-ignored `as any`), plus the in-process `directLink` client.
- **`src/daemonSurface.ts:11-12`** — `oc` + `implement`/`ORPCError`/`Router`. **The needs-design spot.**
  - `:23 kavalDaemonContract = oc.router({ ...ptyHostSurface.contract, surface: { ...ptyHostSurface.contract.surface, control: controlCoreSurface.contract.surface } })` — hand-splicing two already-finalized surface contracts.
  - `:32 KavalDaemonRouter = Router<typeof kavalDaemonContract, Record<never, never>>`.
  - `:56` `ORPCError("PRECONDITION_FAILED")` for the un-drainable `onDrain`.
  - `:69-71` — `implement(kavalDaemonContract as any) as any`, then `t.router({ surface: {...ptyNamespaces, control: controlNamespaces} })`. **Re-adapts two finalized routers against a widened contract.** This exact pattern also appears in `server/src/surface.ts` (see below) and is the trickiest thing to reproduce in Effect.
- **`src/serveOverSocket.ts:22`** — `import type { Router } from "@orpc/server"` only (type). `:78 servePtyHostOverUnixSocket` wraps `@kolu/surface/unix-socket`'s `serveOverUnixSocket`; the file itself is just outcome→log-message mapping.
- **Zero oRPC** in `bin.ts`, `daemonMain.ts`, `stdioBridge.ts`, `ptyHost.ts`, `socketPath.ts`.

---

### `packages/padi` — difficulty: **mechanical for oRPC; needs-design for the singleton DI**

Declares `@orpc/client`, `@orpc/contract`, `@orpc/experimental-publisher`, `@orpc/server`.

**Contract/surface definition — no oRPC import:**
- `src/surface.ts:914` (abs `:914`) `padiSurface = defineSurfaceWithPolicy<ClientErrorPolicy>()({ cells, collections, streams, events, procedures })`; `:327 PADI_SURFACE_VERSION = "4.7"`; `:1351 padiControlSurface = defineSurface(...)`; `:1388 padiDaemonSurfaces = { padi, control }`; `:1395 padiDaemonContract = composeSurfaceContracts(padiDaemonSurfaces)`. Declared procedure errors at `:1137-1141` (`KAVAL_CONTRACT_SKEW` with `data: KavalSkewVersionsSchema`) — framework-declared, thrown via the injected `errors.` constructor at `servePadi.ts:540`, **not** via `ORPCError`.

**Publisher (the only pub/sub in the repo outside surface):**
- **`src/publisher.ts:28`** — `import { MemoryPublisher } from "@orpc/experimental-publisher/memory"`. `:35` one process-global `publisher` instance (`Record<string, any>` — biome-ignored, the library generic is too strict for primitive payloads). `:38 publisherSize()`. `:47 terminalsDirtyChannel = publisherChannel(publisher, "terminals:dirty")` — a single hand-rolled channel. `:57 notifyDirty()` with a try/catch guard around `publish`. **Everything else (cell/collection/event channels) is framework-owned** via the `channel: (name) => publisherChannel(publisher, name)` factory passed to `implementSurfacesOnPublisher`. This one publisher is **shared with kolu-server** (`server/src/surface.ts:44` imports it from `@kolu/padi/assembly`) because its microtask ordering is load-bearing (pinned by `kill.feature`).

**`ORPCError` throw/catch sites (all mechanical):**
- `src/servePadi.ts:24, :689` — `BAD_REQUEST` (upload rejection).
- `src/terminals.ts:19, :199, :210, :215` — `BAD_REQUEST` (acyclic-parent guards).
- `src/terminal-registry.ts:13, :290-291` — `terminalNotFound(id)` → `ORPCError<"NOT_FOUND">` factory.
- `src/preview.ts:30, :84-85` — `previewTooLarge()` → `ORPCError<"PAYLOAD_TOO_LARGE">` factory.
- `src/transcript/transcript.ts:14, :45, :109` — `PRECONDITION_FAILED`, `NOT_FOUND`.
- `src/terminalWorkspace/endpoint.ts:18, :135` — `unwrapGit()` maps `GitResult` failure → `throw new ORPCError(status, {message})`.
- `src/terminalEndpoint/reattachingDeltas.ts:24, :83` — **catch** side: `err instanceof ORPCError && err.code === "NOT_FOUND"` ends the re-attach loop cleanly.
- `src/ptyHost/missingFrozenFragment.ts:1, :6` — **catch** side, imports `ORPCError` from `@orpc/client` (client-side type) to detect a missing frozen control fragment.

**Client-type plumbing:**
- `src/dial.ts:36-37` — `import type { ClientRetryPluginContext } from "@orpc/client/plugins"` + `ContractRouterClient` from `@orpc/contract`. `:86 PadiDaemonClient = ContractRouterClient<PadiDaemonContract, ClientRetryPluginContext>`, `:97 PadiSurfaceClient = ContractRouterClient<typeof padiSurface.contract, ClientRetryPluginContext>`, `:108 scopePadiSurface()` (a `scopeSibling` + cast). Everything else in this file is `@kolu/surface*` (`stdioLink`, `dialSocket`, `dialAgentOnce`, `isContractVersionCompatible`).
- `src/daemonBoot/daemonMain.ts:36` — `import type { Router } from "@orpc/server"`, used only for `readonly router: Router<any, any>` in the `SurfacesServed` phase token (`:172`) and the cast at `:334`.

**Transport: none.** padi serves via `@kolu/surface-daemon`'s `daemonMain` (which owns the unix-socket serve).

**Test files (all `@orpc/server`):** `terminal-registry.test.ts:20`, `servePadi.recycleKaval.test.ts:20`, `terminals.acyclicParent.test.ts:4`, `terminalEndpoint/reattachingDeltas.test.ts:1`, `servePadi.test.ts:18`, `terminalWorkspace/endpoint.test.ts:4` — all `ORPCError`. `ptyHost/connect.test.ts:16-17` uses `oc`/`implement` to build a **legacy version-only fake contract** (`:46`, `:167`, `:199`) for skew testing.

---

### `packages/server` (`kolu-server`) — difficulty: **needs design** (this is the hard package)

Declares `@orpc/client`, `@orpc/contract`, `@orpc/experimental-pino`, `@orpc/experimental-publisher`, `@orpc/server`. **`@orpc/client` and `@orpc/experimental-publisher` are declared but never imported in `src/`** — dead deps.

**`src/index.ts` (1239 lines) — the only transport definition in the whole repo outside surface:**
- `:43` `LoggingHandlerPlugin` from `@orpc/experimental-pino`; `:44` `RPCHandler` from `@orpc/server/fetch`; `:45` `RPCHandler as WsRPCHandler` from `@orpc/server/ws`.
- `:210-224` `rpcPlugins = [new LoggingHandlerPlugin({ logger: log, logRequestAbort: false })]` — pino wiring with two documented opt-outs.
- `:866` `new RPCHandler(appRouter as any, { plugins })`; `:868` `new WsRPCHandler(appRouter as any, { plugins })` — both `as any` (biome-ignored: "appRouter mixes implementSurface's `Lazy<Router>` spread with hand-listed namespaces; oRPC's RPCHandler input type doesn't accept that union").
- `:873-905` HTTP mount `app.use("/rpc/*")` — CSWSH origin gate (`gateHttpRpcOrigin:883`) then `rpcHandler.handle(c.req.raw, { prefix: "/rpc", context: { viewerAddress, forwardedFor } })` at `:889`. **The per-caller context injection.**
- `:1115` `serve(...)` (hono/node-server, optional https).
- `:1158` `new WebSocketServer({noServer:true})`; `:1168 acceptSurfaceSocket({...})` (framework); `:1192 wsRpcHandler.upgrade(ws, { context: { viewerAddress, forwardedFor } })`; `:1212 server.on("upgrade")` + `gateWsOrigin:1222`.

**`src/surface.ts` (514 lines) — the contract-widening seam. The single most delicate oRPC dependency in the repo:**
- `:54-55` `import { oc } from "@orpc/contract"` + `import { implement } from "@orpc/server"`.
- `:121-132` `servedContract = oc.router({ ...contract, surface: { ...composeSurfaceContracts(surfacesWithPadi).surface, [PADI_SURFACE_NAME]: padiHostMap.surfaceContract } })`.
- `:138` `export const t = implement(servedContract)`.
- **Why it matters (comment at `:100-120`):** `implement(C).router(obj)` *silently drops* any key `C` doesn't declare. The re-served `padi` sibling is a `serveSurfaceMap` fragment with no matcher meta of its own, so this widened builder is what **attaches the `/surface/padi/*` routes the RPCHandler matcher needs**. Building `t` against the un-widened `contract` produces a boot-time 404 that `directLink`-based tests cannot see. Pinned by `router.test.ts`.
- `:432` `implementSurfacesOnPublisher(surfaces, { channel: publisherChannel(publisher, …), onStreamReadError }, { surfaceApp: surfaceAppServer(...), kolu: koluDeps })` — framework, **on padi's shared publisher** (`:44 import { publisher } from "@kolu/padi/assembly"`, a distinct constructor, not a flag).
- `:487-490` `koluSurfaces.done.catch(err => { log.fatal(...); process.exit(1) })` — **deliberately fatal** fault policy.
- Reactor cells with fused cadences: `:352 everyMsOr(MEMORY_SAMPLE_INTERVAL_MS, deps.onState)`, `:379 everyMsOr(DAEMON_INVENTORY_SAMPLE_INTERVAL_MS, ...)`, `:399 everyMsOr(FORWARD_REAP_INTERVAL_MS, deps.forwards.onChange)`.

**`src/router.ts` — no oRPC import**, uses only `t` from `surface.ts`:
- `:78 buildAppRouter(deps)` → `t.router({ ...spliced surface (as any at :84), server: { info: t.server.info.handler(...) :92 }, daemon: { restart :101 }, hosts: { viewer :121, add :137, remove :141, reconnect :145, renewDaemon :149 } })`.
- `:121` `viewer` reads `({ context })` — **the one handler consuming oRPC request context**.

**Test files:** `router.test.ts:24` `StandardRPCMatcher` from `@orpc/server/standard` (asserts `/surface/padi/*` and `/server/info` are in the matcher tree, `:53-66`). `portForward/viewerHostRoute.test.ts:17,:45` and `padi/padiBinding.test.ts:73,:278` use `createRouterClient` from `@orpc/server` to drive routers in-process without a link.

---

### `packages/client` (`kolu-client`) — difficulty: **mechanical (trivial)**

Declares `@orpc/client` + `@orpc/contract`; **only `ORPCError` is actually imported.**

- `src/terminal/useTerminals.ts:13, :76` — `err instanceof ORPCError && err.code === "NOT_FOUND"` → swallow.
- `src/right-panel/hostCodeTab.ts:58, :156, :299` — `PRECONDITION_FAILED` and `NOT_FOUND` narrowing.
- `src/kaval/useDaemonRestart.ts:18` — **comment only**; the file imports `isDefinedError, safe` from `@kolu/surface/solid` (`:20`) and uses them at `:67-76` for the declared `KAVAL_CONTRACT_SKEW` error. This is the *intended* pattern.
- Everything else: `src/wire.ts:26-27` `connectSurfaces` (`@kolu/surface-app/solid`) + `connectSurfaceMap` (`@kolu/surface-map/client`); `:182 const link = conn.link`; `:209 app = clients.kolu`; `:227 padiMap = connectSurfaceMap(padiHostMap, conn.transport, {...})`; `:268 client = link` (the only raw-procedure handle: `client.server.info`, `client.daemon.restart`); `:467 activePadiRpc`, `:477 activePadiStreams`.

---

### `packages/xterm-kit` — difficulty: **mechanical (trivial)**

Declares `@orpc/client` for exactly one thing.

- `src/scrollbackBackfill.ts:28, :599` — `if (!(err instanceof ORPCError && err.code === "NOT_FOUND")) opts.onError(err)`. Deliberately scoped to the fetch only; a `prepend` fault stays fail-loud.
- `src/scrollbackBackfill.test.ts:10` — same.

This is the only oRPC dependency in an otherwise framework-free UI-kit package. **Removing it would let xterm-kit drop `@orpc/client` entirely.**

---

### `kaval-tui`, `padi-tui`, `kolu-mcp`, `kolu-cli` — difficulty: **none (no oRPC at all)**

Verified: zero `@orpc` imports in `src/`, zero `@orpc` entries in `package.json`. They consume:
- `kaval-tui`: `@kolu/surface/links/unix-socket` (`connect.ts:13`), `@kolu/surface/client` (`attach.ts:16`, `wait.ts:33`), `@kolu/surface/wait` (`wait.ts:41`), `@kolu/surface/first-frame`, `@kolu/surface/define` (`main.ts:36`), `@kolu/surface-remote`'s `dialAgentOnce` (`main.ts:37`).
- `padi-tui`: `@kolu/padi/dial` (`main.ts:37`, `connect.ts:13`, `hostConnect.ts:34`), `@kolu/surface/mirror` + `first-frame` (`read.ts:15-16`).
- `kolu-mcp`: `@kolu/surface-mcp`'s `serveSurfaceAsMcp` + `BespokeTool` (`serve.ts:22`), `@kolu/padi/dial`'s `PadiSurfaceClient` (`serve.ts:21`), `@kolu/surface/wait` (`wait.ts:35`).
- `kolu-cli`: `@kolu/padi/dial` (`connect.ts:26`, `hostConnect.ts:21`), `@kolu/surface/client`'s `STREAM_RETRY` (`connect.ts:28`), `@kolu/surface-daemon-supervisor` (`mcp.ts:27`).

**These four are proof the framework abstraction holds.** They are zero-cost for the migration.

---

## Daemon / long-running service inventory

### Entry points

| Binary | File | Start mechanism |
|---|---|---|
| `kaval` | `packages/kaval/src/bin.ts` | `parseArgs` → `daemonProcessMain({ name, run: () => runKavalDaemon(...) })` (`:66`); `--stdio` arm → `runStdioBridge` (`:57`) |
| `padi` | `packages/padi/src/daemonBoot/bin.ts` | `parseArgs` → `daemonProcessMain` → `runPadiDaemon`; `--stdio` → `runPadiStdioBridge`; installs `installUnhandledRejectionBoundary` |
| `kolu` | `packages/kolu-cli/src/main.ts` | `koluFaceOrExit()` (cleye, `cli.ts:63`) then a **dynamic import per face**: `mcp` → `runKoluMcp`, `web`/default → `bootKoluWeb(flags)` |

### `kolu-server` — `bootKoluWeb(flags)` (`server/src/index.ts:118`)

Not a class, not a DI container: **one ~1100-line async function** that is the composition root. Guarded by a module-level `let booted = false` (`:112`) that throws on a second call.

Boot order, with the wiring at each step:
1. `:191-207` process-global `uncaughtException` / `unhandledRejection` → `log.fatal` + `process.exit(1)`. **Deliberately fatal, no error boundary at the process level.**
2. `:210` `rpcPlugins` (pino).
3. `:290` `claimLocalSupervisor(localSupervisorStateRoot)` — cross-process single-instance claim.
4. `:311` `pool = buildRemotePool<PadiSession, undefined>({...})` (`@kolu/surface-remote`) — the warm per-host session pool; `:325` each local entry is `ensurePadiBinding({...})`.
5. `:411` `reServes = new Map<string, ReServedSurface<...>>()`, `:412 reServeFor(host, session)` → `:419 reServeSurface({ source: padiSurface, ... })` — lazy per-host mirror, memoized in the Map.
6. `:466` `pool.subscribe(() => pruneToMembers(reServes, ...))` — eviction on membership change.
7. `:481` `localReServe = reServeFor(LOCAL_HOST, padiSession)` eagerly; `:483 surfaceClientRef(...)` for the in-process memory-sampler client.
8. `:491` `padiMap = serveHostMap(padiHostMap, pool, { linkFor: directLink(reServeFor(h,s).router), failureOf: padiFailureOf, project: sessionConnection, ... })`.
9. `:682 makeHostPortsReader({...})`, `:702 forwards = createKoluForwards({...})`, `:714 pool.subscribe(...)` for departed-host forward reaping.
10. `:731 viewerHost = makeViewerHostResolver({ hosts: () => pool.hosts() })`.
11. `:740 newTerminalPolicyPusher = installNewTerminalPolicyPusher({ pool, getPolicy, log })`.
12. `:771 { router: koluSurfaceRouter } = implementKoluSurface({...})`.
13. `:815 appRouter = buildAppRouter({ surfaceRouter, viewerHost, addHost, removeHost, reconnectHost, renewHostDaemon })`.
14. `:866/:868` the two RPC handlers; `:873` HTTP mount; `:1115` `serve()`; `:1158-1230` the WS server + upgrade gate.

**DI/singleton patterns in kolu-server:**
- **Module-level constants captured at import:** `hostname.ts:7 serverHostname`, `:10 serverProcessId = randomUUID()`, `:17 serverStartedAt`, `:22 serverCommit`, `:31 serverVersion` — all `export const` evaluated at module load.
- **Module-level logger:** `log.ts:21 export const log = pino(...)`, level from `process.env.LOG_LEVEL` at `:14`.
- **Module-level Conf store:** `state.ts:244 export const store = new Conf<PersistedState>({...})`.
- **Module-level oRPC builder:** `surface.ts:138 export const t = implement(servedContract)` — imported by `router.ts:26`. A true cross-module singleton.
- Everything else is **closure-passed deps** (`BuildAppRouterDeps` at `router.ts:28`, `KoluSurfaceDeps` at `surface.ts:190`, `EnsurePadiBindingOptions` at `padiBinding.ts:354`). This part is already Effect-Layer-shaped.

### `padi` daemon — `runPadiDaemon(opts)` (`padi/src/daemonBoot/daemonMain.ts:374`)

Already has a **typed phase pipeline** where each phase consumes the previous phase's token — `HeldGate → StoresReady → IdentityReady → SurfacesServed → EndpointBooted` (`:148-190`). This is a hand-rolled compile-time ordering proof and maps very naturally onto `Layer` dependencies.

Boot: resolve state-root (`:381`) → `configureDaemonLog` (`:387`) → `padiRuntimeHome` (`:389`) → `claimPidGate` (`:420`) → `openStateStores` (`:203`) → `configureDaemonIdentity` (`:223`) → `daemonLifetimeFromEnv` (`:452`) → build `drainController` + `onDrain` (`:459-490`) → `serveDaemonSurfaces` (`:261`) → `bootLocalEndpoint` (`:345`) → `writeStateRootManifest` ×2 → `daemonMain({home, router, lifetime, anchor, gate, ...})` → `finally { await served.close() }` (`:562`).

**`serveDaemonSurfaces` (`:261-343`)** is the surface serve: `implementSurfacesOnPublisher(padiDaemonSurfaces, { channel: publisherChannel(publisher, name), onStreamReadError, identity: { padi: {...} } }, { padi: buildPadiSurfaceDeps(...), control: buildControlCoreDeps(...) })`, then `setPadiSurfaceCtx(runtime.ctx.padi)` (`:320`), then `runtime.done.catch(log.error)` (`:328` — **loud-not-fatal**, unlike kolu-server's fatal policy).

**DI/singleton patterns in padi — this is the migration's real work:**

| File:line | Pattern |
|---|---|
| `padiSurfaceCtx.ts:20` + `lateBoundSurfaceCtx.ts:33` | **Late-bound proxy singleton.** `createLateBoundSurfaceCtx<S>(name)` returns `{ proxy, set, resetForTest, noopForTest }`. The `proxy` throws on access before `set`. Exists to break the `surface.ts ↔ domain module` import cycle and dodge a production-only ESM TDZ crash (#1005). **~5 domain modules import `padiSurfaceCtx` directly.** This is the single biggest Effect-Service candidate. |
| `session/confStores.ts:24,27,30` | Three `let store: CellStore<...> \| undefined` + `setPadiXStore()` / `requirePadiXStore()` pairs (`:34,:42,:48` / `:69,:74,:79`). Classic inject-then-require. |
| `ptyHost/index.ts:105` | `let spawnServerVersion: string \| undefined` + `requireSpawnServerVersion():116` / `setSpawnServerVersion():127`. |
| `ptyHost/index.ts:132` | `let endpoint: Endpoint<PtyHostClient,...> \| undefined` — the live kaval connection. |
| `ptyHost/index.ts:162` | `let triggerRestart: <Ctx>(steps) => Promise<void> \| undefined`. |
| `ptyHost/index.ts:~185` | `makeForwardingClient(getRoot)` — a **`Proxy`-based forwarding client** so a captured `ptyHostClient` reference stays valid across a daemon recycle. Effect would express this as a `Service` with a `Ref`. |
| `ptyHost/index.ts:394` | `let infoPromise: Promise<PtyHostSystemInfo> \| undefined` — memoized async read. |
| `ptyHost/daemonStatus.ts:18,26,55` | `const store = new Map<string, DaemonStatus>()`, `let localSocketPath`, `let padiServeSocketPath` + setters `:40,:59,:161`. |
| `terminal-registry.ts:95` | `const terminals = new Map<TerminalId, TerminalProcess>()` — **the terminal registry is a module-global Map.** `require*` accessors at `:242,:254,:277`. |
| `terminals.ts:319` | `let activeTerminalId: TerminalId \| null = null` + `setActiveTerminalId:339`. |
| `session/autosaveGate.ts:77,87` | `let saveTimer`, `const activeFreezes = new Map<symbol,string>()`; `initAutosaveGate():158` injects `{snapshot, isRestorePending, persist}` and starts a `for await` loop over `terminalsDirtyChannel.subscribe(undefined)` at `:161`. |
| `koluRoot.ts:29` | `let daemonProcessId` + `setDaemonProcessId:63`. |
| `log.ts:73` | `let active: Logger = buildDefaultLogger()`, swapped by `configureDaemonLog`. |
| `servePadi.ts:126` | `let standingFinishQuiet: FinishQuiet \| undefined`. |
| `daemonBoot/unhandledRejectionBoundary.ts:60,71` | `let healthSink`, `let installed`. |
| `terminalWorkspace/sensors.ts:527` | `const activations = new Map<string, ExternalChangesActivation>()`. |

### Long-running loops / timers (all packages)

| Location | Shape |
|---|---|
| `server/src/surface.ts:352,:379,:399` | `everyMsOr(ms, subscribe)` reactor cadences: memory sampler, daemon inventory, forward reaper |
| `server/src/index.ts:466,:714` | `pool.subscribe(cb)` — two membership-change reactions (re-serve eviction; forward reaping) |
| `server/src/padi/newTerminalPolicy.ts:156,:188` | `pool.subscribe` → `emit(pool.hosts())`; `family.subscribe(scanForConnects)` |
| `server/src/portForward/forwards.ts:58,:277` | `FORWARD_REAP_INTERVAL_MS = 5_000`; `subscribe(tick)` |
| `padi/src/servePadi.ts:233,:250` | `everyMsOr(...)` for host inventory + memory (`onDaemonStatusChange`) |
| `padi/src/servePadi.ts:416` | `for await (const exitCode of bus.subscribe(signal))` — the `terminalExit` event source |
| `padi/src/servePadi.ts:388-402` | `terminalAttach` stream: `async function*` that awaits the endpoint attach, yields a snapshot frame, then `for await (const frame of deltas)` |
| `padi/src/ports/sampler.ts:76,:320` | `PORT_SCAN_INTERVAL_MS = 5_000`; `everyMsOr(PORT_SCAN_INTERVAL_MS, tick => ...)` |
| `padi/src/activity/finishQuiet.ts:129` | `genSrc.subscribe(() => {})` keep-alive |
| `padi/src/session/autosaveGate.ts:161` | `for await` over the dirty channel |
| `padi/src/terminalEndpoint/inventoryReconcile.ts:53` | `startInventoryReconciler(signal)` |
| `padi/src/terminalEndpoint/local.ts:316,:385` | `bridgeStream<T>` (`for await` at `:334`) and `resubscribeStream` (`ACTIVITY_RESUBSCRIBE_DELAY_MS = 2_000` at `:368`) — the VT-tap fan-in from kaval's streams |
| `padi/src/terminalWorkspace/sensors.ts:818` | `setTimeout`-chained (not `setInterval`) screen poll so a slow read can't overlap |
| `padi/src/fsGitDeps.ts:19` | `@parcel/watcher`-backed `subscribeRepoChange`/`subscribeFileChange` |

---

## Difficulty notes, ranked

| Package | Verdict | Reason |
|---|---|---|
| `kaval-tui` / `padi-tui` / `kolu-mcp` / `kolu-cli` | **none** | zero oRPC; pure `@kolu/surface*` consumers |
| `xterm-kit` | **mechanical (trivial)** | one `instanceof ORPCError` check; drops the dep entirely once there's a framework-level error predicate |
| `client` | **mechanical (trivial)** | three `instanceof ORPCError` sites; already uses `safe`/`isDefinedError` from `@kolu/surface/solid` as the intended pattern |
| `common` | **needs design (small)** | one `oc.router` mixing `composeSurfaceContracts` with 5 raw procedures. `hosts.viewer` needs a per-request-context equivalent |
| `kaval` | **mostly mechanical + 1 needs-design** | 2 `ORPCError` throws + `Router`/`ContractRouterClient` types are mechanical. `daemonSurface.ts:69-71` (`implement(contract as any).router({...spread finalized routers})`) is the design spot |
| `padi` | **mechanical for oRPC, needs-design for DI** | oRPC itself is 8 `ORPCError` sites + one `MemoryPublisher` + type imports — all easy. The **~15 module-level mutable singletons** (esp. the `lateBoundSurfaceCtx` proxy and the `terminals` Map) are the real Layer/Service work. The `daemonMain.ts` phase-token pipeline is already Layer-shaped and should port cleanly |
| `server` | **needs design (hardest)** | The only transport definition (`RPCHandler` fetch + ws + pino plugin + per-caller context at `index.ts:889/:1192`); the contract-widening matcher seam at `surface.ts:121-138` (a silent-404 trap if reproduced wrong); a 1100-line imperative composition root; the shared-publisher coupling to padi; and a `process.exit(1)` fault policy that differs from padi's loud-not-fatal one |

### Cross-cutting design questions the migration must answer

1. **Per-caller request context.** `hosts.viewer` (`common/src/contract.ts:101`, handler `server/src/router.ts:121`) is the *only* consumer, but it is structurally load-bearing — the answer differs per connection, so a broadcast surface cell cannot carry it. Both transport mounts inject `{ viewerAddress, forwardedFor }`.
2. **The matcher-tree widening.** `server/src/surface.ts:100-138` and `kaval/src/daemonSurface.ts:63-73` both re-adapt an already-finalized router against a widened contract to attach route metadata. Both carry `as any`. Pinned by `server/src/router.test.ts:53-66` via `StandardRPCMatcher`.
3. **The shared publisher.** One `MemoryPublisher` (`padi/src/publisher.ts:35`) is used by *both* padi's daemon and kolu-server's in-process surface, and its **cross-channel microtask ordering is load-bearing** (`server/src/surface.ts:~425` comment; pinned by `kill.feature`). Any Effect queue/PubSub replacement must preserve that ordering.
4. **Divergent fault dispositions.** kolu-server: `done.catch → process.exit(1)` (`surface.ts:487`). padi: `done.catch → log.error`, process survives (`daemonMain.ts:328`). kaval: `done.catch → log.error` (`daemonMain.ts:~103`). These should stay distinct, not be unified by the migration.
5. **`Router<any, any>` is the universal escape hatch** — appears at `kaval/inProcessPtyHost.ts:502,:521`, `kaval/serveOverSocket.ts:81`, `padi/daemonBoot/daemonMain.ts:172,:334`, `server/index.ts:866,:868`. Every serving site casts. A typed Effect equivalent would be a real win here.