import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface RunEdge {
  readonly path: string;
  readonly sites: number;
  readonly why: string;
}

export const RUN_EDGE_ALLOWLIST: readonly RunEdge[] = [
  {
    path: "packages/acp-client/src/agent.ts",
    sites: 3,
    why: "the ACP client's callback edges, where an SDK or subprocess callback with no fiber has to reach Effect: the log emitter captured from the fiber that built the agent (so a stderr line or a protocol callback logs under that fiber's level and annotations), and the two places a Promise-shaped stop — a sign-in attempt's `stop` and the stop that joins every request still alongside the process — interrupts a fiber it holds. Each caller is a Promise contract the client does not own, so there is no Effect caller above it to compose into",
  },
  {
    path: "packages/acp-harness/src/conversation.ts",
    sites: 1,
    why: "the conductor conversation's ONE boundary onto `@kolu/acp-client`: that package's verbs are Effects and this one's door is promises (kolu-server holds the harness from a Promise-shaped procedure), so every verb crosses through one helper that provides the logger layer forwarding to the caller's own log and turns the client's typed failure into this package's refusal. A run per verb would be a dozen places that layer could be forgotten",
  },
  {
    path: "packages/client/src/runAction.ts",
    sites: 2,
    why: "THE SolidJS client's Effect→UI edge, named once so the ~100 DOM handlers above it read as `runAction(label, program)` instead of ~100 forks biome's Promise rules cannot see: a `runFork` for an event handler / owner-scoped launch, and a `runPromise` for the three seams whose Promise contract is not this package's (Solid's `createResource` fetcher, xterm-kit's backfill `fetch`, and `pollOnChange`'s signal-carrying read — the last driving interruption from the caller's AbortSignal)",
  },
  {
    path: "packages/kaval-tui/src/main.ts",
    sites: 1,
    why: "kaval-tui's process edge; a Promise rather than `NodeRuntime.runMain` because that turns SIGINT into fiber interruption, and an interrupted fiber cannot emit the `--json` frame + trailer a `wait` interrupted at 130 must still print",
  },
  {
    path: "packages/kaval/src/contractCorpus.testlib.ts",
    sites: 38,
    why: "the pty-host contract corpus — one run per procedure and stream it asserts on, each inside a vitest `it` body, which IS the harness's Promise boundary; a `.testlib.ts` rather than a `.test.ts` only because vitest's `include` and default.nix's staleKey filter both key on the suffix, so it is scanned like the production tree it sits in and the count moves only when `CONTRACT_COVERAGE` does",
  },
  {
    path: "packages/kaval/src/selfLiveness.ts",
    sites: 1,
    why: "the self-liveness probe's raw-timer edge (juspay/kolu#2101 N2): the cadence rides a chained unref'd `setTimeout` by written ruling at the site (heap-diag's precedent — Effect 4's default Clock sleeps on a ref'd timeout that would hold the process open), so each tick is its own process boundary with no Effect caller to compose into; one run per tick, matching the loop shape",
  },
  {
    path: "packages/kaval/src/stdioBridge.ts",
    sites: 1,
    why: "the `kaval --stdio` front's converge-before-relay pre-step (juspay/kolu#2101), now inside the `runStdioBridgeWith(opts, deps)` ordering seam the test pins rather than inline in the CLI shim: the convergence kit is Effect-native all the way down, but this is a CLI entry whose caller is `bin.ts`'s Promise `.catch` and whose continuation — `frontDaemonOverStdio` — is Promise-shaped by its own contract-blind contract, so there is no caller left to compose into; one crossing, at the boundary, before a single byte is relayed",
  },
  {
    path: "packages/kaval/src/streamFrame.testlib.ts",
    sites: 1,
    why: "`runScopedSync` — the kaval suite's one scoped-acquire read, synchronous ON PURPOSE: attach's publish-epoch coalescing is observable only when a burst of attaches shares a tick, so a Promise hop between two of them would erase the thing under test",
  },
  {
    path: "packages/kolu-cli/src/e2eDaemon.testlib.ts",
    sites: 1,
    why: "the e2e daemon harness's readiness probe — poll-dial a REAL padi until its control-core `hello` answers. The loop is Promise+timeout shaped because what it waits on is a process coming up, not a value arriving, and every caller is a vitest `it`/`beforeAll` body: the harness's own Promise boundary, with no Effect caller to compose into. A `.testlib.ts` and not a `.test.ts` for the reason this scan cares about: the alternative is not fewer runs but the SAME probe copied into every e2e file that spawns a daemon — and the copy is the one that drifts, in a module whose whole job is reaping the user's real daemon by exact pid",
  },
  {
    path: "packages/kolu-cli/src/main.ts",
    sites: 1,
    why: "the product binary's process edge; `NodeRuntime.runMain` rather than a Promise because kolu-cli's exit-code map is LOCAL — every failure carries its own `Runtime.errorExitCode`, so the default teardown IS the map",
  },
  {
    path: "packages/kolu-cli/src/mcp.ts",
    sites: 1,
    why: "the MCP-SDK's connect callback — `serveSurfaceAsMcp` asks for `() => Promise<Connection>` and OWNS the connection it gets, re-invoking it on its own redial path, so the crossing cannot be composed away without changing kolu-mcp's face",
  },
  {
    path: "packages/kolu-cli/src/surfaceFace.ts",
    sites: 1,
    why: "the kindred of `mcp.ts`'s entry one seam over: `@kolu/surface-cli`'s `ResolvedEndpoint.open` is `() => Promise<Connection>` and the FRAMEWORK owns its invocation (a dial per subscription inside `surfaceCommands`), exactly the connect-callback shape `mcp.ts` lists — the `endpoint.resolve` Effect ends at the value the face hands over, and `dialOf`'s own Effect cannot compose into a repo caller that does not exist",
  },
  {
    path: "packages/kolu-cli/src/verbs/stdoutPump.fixture.ts",
    sites: 2,
    why: "a CHILD PROCESS, not a module: `shared.flush.test.ts` spawns this file so the pump it drives writes to a real pipe(2) that a real `head` reads. It is that child's process edge, and there is no Effect caller on this side of the fork to compose into — the caller is `spawn`. Two runs because the queue and the drain are two lifetimes: one creates the queue the fixture then offers into, the other drains it through `shared.ts`'s `stdoutSink` for as long as the child lives. Deliberately the SHIPPED sink and not a hand-written write, because a fixture that writes to the fd itself passes whatever the verb does — which is how the previous version of this fixture came to pin nothing",
  },
  {
    path: "packages/padi-client/src/watch.ts",
    sites: 2,
    why: "both crossings are into `@kolu/surface/wait`'s `runWait`, and both are PROCEDURES. The scaffold is Promise+AbortSignal shaped BY DESIGN, so a watcher body is a non-Effect runtime with no Effect caller above it to compose into; a stream is consumed through this file's own `iterateUntilAborted` bridge, but a procedure has nowhere else to be run. One site is `awaitWatchEvents`' `watch.drain`. The other is `awaitTerminalCondition`'s `screen.text` — the `--snapshot` / `kolu debrief` stamp (kolu#2139), which cannot move outside the wait: it is read while the subscriptions that decide whether it is STILL the screen that settled are live, and it passes `{ signal: ctx.signal }` so a settled timeout is never held open by an unanswered reply",
  },
  {
    path: "packages/padi-tui/src/main.ts",
    sites: 1,
    why: "padi-tui's process edge; a Promise rather than `NodeRuntime.runMain` because that turns SIGINT into fiber interruption, and this CLI's stop semantics are PER COMMAND — a `watch` the user stopped is a clean 0, a `wait` interrupted is a 130 that must still print which terminal was left waiting",
  },
  {
    path: "packages/padi/src/daemonBoot/daemonMain.ts",
    sites: 1,
    why: "padi's daemon process edge; a Promise rather than `NodeRuntime.runMain` because the exit-code map lives in the spine's `daemonProcessMain`, which kaval rides too",
  },
  {
    path: "packages/padi/src/daemonBoot/stdioBridge.ts",
    sites: 1,
    why: "the `padi --stdio` front's converge-before-relay pre-step (juspay/kolu#2101) — the twin of kaval's row, for the same reason: a CLI entry whose caller is `bin.ts`'s Promise `.catch`, whose continuation `frontDaemonOverStdio` is Promise-shaped by contract, and which must run the full convergence BEFORE the relay engages (that ordering is the whole fix, so it cannot move inward)",
  },
  {
    path: "packages/padi/src/kavalSupervision.ts",
    sites: 2,
    why: "steady-state kaval supervision's raw-timer edge (juspay/kolu#2101 N1): the tick rides a chained unref'd `setTimeout` for the same written reasons as kaval's self-liveness row, so the probe read and the observe/repair step each cross at the tick boundary — two runs, one cadence, no Effect caller above the timer to compose into",
  },
  {
    path: "packages/padi/src/odu.ts",
    sites: 1,
    why: "the odu sibling's ADMIT hook, Promise-shaped by the framework's own `Admit<Client>` contract (`makeSession` runs it once per dial, between the transport coming up and the session adopting the link) while the thing it has to read — odu's `service` cell — is Effect-native. The two meet in this one seam, and it is a HANDSHAKE rather than a data path: every subscription after it is relayed by `reServeSurface`, which composes Effects all the way down and crosses nothing",
  },
  {
    path: "packages/padi/src/ports/sampler.ts",
    sites: 1,
    why: "the port sampler's reactor-poll edge: the reactor's `read` dep is `() => Promise<T>` by design (a poll source owns its own cadence and is deliberately non-Effect — H1), and `scanSubtreePorts` is Effect-native now that osfacts-client returns Effects, so the two meet in the ONE default `scan` seam instead of at each use inside the read; it is a separate row from `servePadi.ts`'s because this sampler is driven OUTSIDE `derived.cell` (its samples re-enter each terminal's own producer through the sensor channel), so there is no padi surface cell to route it through",
  },
  {
    path: "packages/padi/src/ptyHost/linkLoss.ts",
    sites: 2,
    why: "the link-loss healer's raw-timer edge (juspay/kolu#2182): the tick rides a chained unref'd `setTimeout` for the same written reasons as `kavalSupervision.ts`'s row (Effect's default Clock cannot express an unref'd sleep, and the endpoint's `onStatus` emit is synchronous, so nothing above the timer is an Effect caller to compose into), so BOTH of the tick's reads cross at that boundary — the residency precondition and, only if it says the daemon is serving, the re-converge attempt. Two runs, one cadence, and deliberately two rather than one composed Effect: the precondition decides whether the second one happens at all, and folding them would put a converge (which SPAWNS when nobody is home) inside the same run as the reading meant to forbid it",
  },
  {
    path: "packages/padi/src/servePadi.ts",
    sites: 1,
    why: "padi's ONE reactor-poll edge, named once for both poll cells: the reactor's `read` dep is `() => Promise<T>` by design (a poll source owns its own cadence and is deliberately non-Effect), and the host-inventory and memory samplers behind it are Effect-native, so this is where they meet — kolu-server carries the twin row for the same reason",
  },
  {
    path: "packages/padi/src/terminalEndpoint/local.ts",
    sites: 1,
    why: "the tap layer's one edge — the surrounding lifecycle (`TerminalLifecycle.abort`, the reconciler) is AbortController-shaped, and this is where a signal becomes fiber interruption",
  },
  {
    path: "packages/server/bench/typingEchoLatency.ts",
    sites: 1,
    why: "the typing-echo latency bench's process edge — the probe is ONE program (a padi member call is a lazy Effect, and awaiting one dispatches nothing, which is how this bench rotted), so the dial, the keystroke loop and the attach subscription all compose into a single run here; it runs the EXIT so a failed measurement prints the wire's own Cause and exits non-zero for `bench/run.sh` instead of reporting numbers it never measured",
  },
  {
    path: "packages/server/src/agentDelivery/install.ts",
    sites: 1,
    why: "agent delivery's report to a host's padi: `agentDistro.report` is an Effect, but the delivery it serves is driven by Nix child processes and upstream's clock (`./delivery.ts`, `./schedule.ts` — Promise-shaped all the way down, off a timer and the pusher's `onPushed` callback), so `DeliveryHost.report` is the one seam where the padi call is run; it awaits the run, so a padi that refuses the report fails that host's delivery instead of being dropped",
  },
  {
    path: "packages/server/src/conductor/koluOffer.ts",
    sites: 1,
    why: "kolu-conductor's `KoluOffer` port is Promise-shaped and `kolu-conductor` knows nothing of Effect, so this adapter is the boundary where a host's padi reads are run — its `agentDistro.models` answer and its `agentDistroStatus` frame, both through the one `settled` helper that turns a failure into its own words; the same edge, and the same reason, as `workFiles.ts`'s row",
  },
  {
    path: "packages/server/src/conductor/watcher.ts",
    sites: 2,
    why: "the Conductor's watcher: the whole watch — every connected host's standing subscription, each watched terminal's record lineage, and the host-map and watch-list triggers that re-scope them — is ONE long-lived stream, forked once when kolu-server boots (`startConductorWatcher` is called from synchronous wiring that hands down no Effect), and interrupted once by `dispose`, which the shutdown awaits as a Promise",
  },
  {
    path: "packages/server/src/conductor/workFiles.ts",
    sites: 2,
    why: "kolu-conductor's `WorkFiles` port is Promise-shaped and `kolu-conductor` knows nothing of Effect, so this adapter is the boundary where padi's Effect-typed reads are run — one per port verb (`fs.listDirectory` for the `.waterfall/` listing, the remote preview assembly for the copy a finished work keeps); composing them into the caller would push Effect into kolu-conductor",
  },
  {
    path: "packages/server/src/index.ts",
    sites: 2,
    why: "the two edges of an orderly async boot (locked decision 1): the reactor's poll dep is `() => Promise<T>` — its ENGINE is Effect's Atom, but its FACE is deliberately synchronous and non-Effect; and binding the listener, since `serveSurfaceApp` is a scoped `Effect` and `bootKoluWeb` is a plain async function with no Effect context to hand it (the node `request`-callback edge this file used to carry is GONE — the primitive owns that boundary now)",
  },
  {
    path: "packages/server/src/padi/padiBinding.ts",
    sites: 1,
    why: "the local padi `Connector` plug — `@kolu/surface-remote`'s reconnect loop asks for `(ctx) => Promise<Connection>` and OWNS the connection it gets, re-invoking it on its own redial path, so this is where kolu-server's Effect-native `converge(ep)` joins a Promise-shaped seam it does not own (that session machinery is the campaign's recorded residual)",
  },
  {
    path: "packages/server/src/padi/padiCellPusher.ts",
    sites: 1,
    why: "the padi cell pusher's edge (the new-terminal theme policy and the Agents setting): a cell `set` is an Effect, but every caller above it is a SYNCHRONOUS framework callback that hands down no Effect, Scope or Promise slot (`reactiveFamily`'s change edge; `CellHandlerDeps.onWrite: (next: T) => void`), so making the pusher an Effect would only move an un-run description into a `() => void` that discards it — and a discarded description is a push that silently stops firing",
  },
  {
    path: "packages/server/src/padi/remotePadiBinding.ts",
    sites: 1,
    why: "the remote padi `Admit` plug — the same surface-remote seam, ssh arm: `makeSession` asks for `(client) => Promise<AdmitVerdict>`, and `convergeAdmit` is an Effect",
  },
  {
    path: "packages/server/src/portForward/hostPorts.ts",
    sites: 1,
    why: "one edge for the whole host-ports reading, because its caller is a reactor poll cell — every subscription the read opens stays inside the one fiber tree",
  },
  {
    path: "packages/server/src/wireCall.ts",
    sites: 1,
    why: "`kolu-rpc`'s process edge — the one-shot harness caller places exactly one call and exits, and it runs the Exit (not the value) because a shell needs the CAUSE on stderr",
  },
  {
    path: "packages/solid-logtail/src/LogTail.tsx",
    sites: 1,
    why: "the log tail's own copy edge: the block IS the affordance — its button, its `copied` flash — and the write it runs (`writeTextToClipboard`'s ladder into `execCommand`, for the non-secure context a LAN or Tailscale URL has no `navigator.clipboard` in) must START on the click's own stack, so there is no caller left to compose into. A leaf package cannot reach the app's `runAction` edge above, which is why a failure leaves through a REQUIRED `onCopyError(message)` prop rather than a toast the package would have to own; one crossing, inside the click handler",
  },
  {
    path: "packages/surface-app/example/src/server/main.ts",
    sites: 2,
    why: "boot and shutdown of the listener's ONE scope, in a top-level script: `serveSurfaceApp(...)` at module load, and `Scope.close` inside the SIGINT/SIGTERM handler — a node signal callback is a non-Effect runtime, so the close cannot compose into the boot. The `request`-callback edge this file used to carry is GONE: `serveSurfaceApp` owns that boundary now, which is the whole point of the primitive",
  },
  {
    path: "packages/surface-app/src/connect.ts",
    sites: 1,
    why: "THE `pid` echo's edge: the reserved `system/identity` round-trip is an Effect, but `wire.onStatus` is a plain callback with no Effect to compose into, and what the probe produces is a MUTABLE the URL thunk reads on the next dial — there is no continuation to hand it to. Held here, at the one seam that dials a surface app's wire, precisely so it is not one edge per consuming app: the old arrangement made every app open its own (`createServerLifecycle`'s `onProcessId`), and an app that didn't (olai#61) shipped a dead stale-tab handshake",
  },
  {
    path: "packages/surface-app/src/httpDrive.testlib.ts",
    sites: 1,
    why: "the static-layer suite's ONE request edge: `drive` builds an `HttpRouter` app, hands it a raw request and reads the response body, and every caller is a vitest `it` body — the harness's own Promise boundary, with no Effect caller to compose into. It is a `.testlib.ts` and not a `.test.ts` for the reason this scan cares about: two suites need it (`server.test.ts` asserts headers and text, `dist.test.ts` compares COMPRESSED bodies byte for byte), so the alternative is not fewer runs but the SAME run copied into two files this scan excludes — a duplicate that would drift silently and be invisible here by construction. One row is the honest form of that",
  },
  {
    path: "packages/surface-app/src/server.ts",
    sites: 2,
    why: "the per-connection serve boundary: build the serving layer into a connection-scoped `Scope` when a socket opens, close that scope when it ends — a `ws` callback either side",
  },
  {
    path: "packages/surface-app/src/solid/index.ts",
    sites: 1,
    why: "the server-lifecycle probe edge: the reserved `system/identity` round-trip is an Effect, but the lifecycle hangs off `wire.onStatus` (a plain callback) and `createHeartbeat` races a probe against a timer, so the crossing is real — held here once rather than at each of the three consumers, and deliberately NOT folded into `liveSignal`'s edge, which takes no caller-supplied probe target on purpose (#1564)",
  },
  {
    path: "packages/surface-cli/src/host.fixture.ts",
    sites: 1,
    why: "the fixture binary's `main` — a SPAWNED process is the only place an exit code exists, so the suite asserts the published matrix against a real `runMain` instead of a simulated one. It is a `.fixture.ts` and not a `.test.ts` precisely because the test file is the PARENT that spawns it: the code under assertion is the child's edge, which by construction cannot run inside the runner's own process",
  },
  {
    path: "packages/surface-map/src/server.ts",
    sites: 1,
    why: "`decodeCanonicalWireKeyUnsafe` — the documented sync-decode edge: a pure suspend over an already-gated key, inside a handler's snapshot read",
  },
  {
    path: "packages/surface-mcp/src/pusher.ts",
    sites: 1,
    why: "one fiber per subscribed MCP resource URI; the SDK's subscribe/unsubscribe surface is callback-shaped, so the fiber handle IS the subscription",
  },
  {
    path: "packages/surface-mcp/src/server.ts",
    sites: 1,
    why: "`resources/read` — the MCP request edge, with the request's own AbortSignal handed to the run so a cancelled read interrupts every subscription it opened",
  },
  {
    path: "packages/surface-remote/src/session.ts",
    sites: 1,
    why: "THE session's probe edge — the three framework-reserved round-trips are Effects, and the dial/reconnect machinery that consumes them is Promise- and timer-shaped BY CONTRACT (the campaign's recorded residual), so the two meet here once instead of three times; the abort it takes becomes fiber interruption, which is strictly stronger than the signal these probes used to be handed",
  },
  {
    path: "packages/surface/example/fleet-top/part-1/src/client/App.tsx",
    sites: 1,
    why: "part 1's DOM handler — a declared procedure is a description and a click is where the example runs it, which is the lesson that page of the tutorial exists to teach",
  },
  {
    path: "packages/surface/example/fleet-top/part-1/src/inproc.ts",
    sites: 1,
    why: "the in-process demo's snapshot read: a `Promise<T>` face over `Stream.runHead`, because the plain async node script that calls it has no Effect to compose into",
  },
  {
    path: "packages/surface/example/fleet-top/part-1/src/server/main.ts",
    sites: 1,
    why: "part 1's node `request` callback — a callback node hands no Effect context to, so the composed HTTP layer is built into it here",
  },
  {
    path: "packages/surface/example/fleet-top/part-2/src/supervisor/main.ts",
    sites: 1,
    why: "the supervisor example's process edge: one run for `main`, with the failure written to stderr and mapped to a non-zero exit — the shape a reader's own `main` should copy",
  },
  {
    path: "packages/surface/example/fleet-top/part-3/src/client/App.tsx",
    sites: 1,
    why: "part 3's DOM handler, on the ACTIVE host's face — switching hosts changes WHICH surface is called, not where it is run",
  },
  {
    path: "packages/surface/example/fleet-top/part-3/src/server/main.ts",
    sites: 1,
    why: "part 3's node `request` callback, twin of part 1's",
  },
  {
    path: "packages/surface/example/mini-ci/src/tui/main.ts",
    sites: 2,
    why: "the mini-CI TUI's two edges: draining the `nodes` stream until the pipeline settles (an async `main` awaits it) and a stdin keypress re-running a node — a Promise-shaped main on one side, a node callback on the other",
  },
  {
    path: "packages/surface/example/mini-ci/src/tui/members.ts",
    sites: 1,
    why: "one fiber per subscribed member, because the TUI's subscribe face hands back a synchronous `() => void` stopper — the fiber handle IS the subscription",
  },
  {
    path: "packages/surface/example/remote-process-monitor/src/client/App.tsx",
    sites: 1,
    why: "the monitor's kill button — a DOM handler running the `catchCause`-wrapped procedure, so a failed kill prints instead of vanishing",
  },
  {
    path: "packages/surface/example/remote-process-monitor/src/server/main.ts",
    sites: 1,
    why: "the monitor server's node `request` callback",
  },
  {
    path: "packages/surface/example/remote-process-monitor/src/server/serve.ts",
    sites: 1,
    why: "the bridge's kill forwarder: the parent's procedure body is an `Effect.promise` (an undeclared error channel must stay a loud defect), and the remote member it forwards to is Effect-native, so the two meet inside that one Promise",
  },
  {
    path: "packages/surface/example/snippets/cli.ts",
    sites: 1,
    why: "the mount block the `@kolu/surface-cli` reference and the expose-to-a-terminal page embed: a reader copying this page copies its run edge, so the snippet has to show the WHOLE recipe — `reportingRunEdge` piped in and `disableErrorReporting: true` handed to `runMain` — because the half a shortened snippet would drop is the half that decides whether a failing binary says anything at all. Typechecked, never executed",
  },
  {
    path: "packages/surface/example/snippets/consume-cli.ts",
    sites: 1,
    why: "the CLI snippet's ONE process edge, and the whole point of the snippet: everything above is a value, and this is the only line that makes anything happen",
  },
  {
    path: "packages/surface/example/snippets/consume-solid.ts",
    sites: 1,
    why: "the Solid snippet's UI edge, shown inline so a reader copying the four `.use()` lines above it sees WHERE the one run belongs",
  },
  {
    path: "packages/surface/example/snippets/test-a-surface.ts",
    sites: 3,
    why: "the testing snippet's three harness edges — a first-frame read, a procedure call, and a `runForEach` drain to a terminal frame — which is what a reader comes to this snippet to copy; the procedure's run was MISSING until the alias scan caught it, and the page's own prose (\"a test is a process edge\") had been describing code that dispatched nothing",
  },
  {
    path: "packages/surface/example/src/client/App.tsx",
    sites: 3,
    why: "the notes example's three UI edges — create, upsert, delete — each run in the DOM handler that asked for it and nowhere deeper, which is the rule the example is demonstrating",
  },
  {
    path: "packages/surface/example/src/server/main.ts",
    sites: 1,
    why: "the notes example's node `request` callback",
  },
  {
    path: "packages/surface/src/handlerDispatch.testlib.ts",
    sites: 4,
    why: "the zero-transport test dispatcher: a unary call to a Promise, a fork for a stream subscription, that fiber's interrupt-on-stop, and a first-frame read — the Effect plumbing every handler unit test would otherwise repeat, held once and NOT exported from the package",
  },
  {
    path: "packages/surface/src/links/websocket.ts",
    sites: 1,
    why: "constructing the browser leg's reconnecting WebSocket — the link factory is a Promise-returning constructor its non-Effect callers await",
  },
  {
    path: "packages/surface/src/links/wire.ts",
    sites: 3,
    why: "the link's own lifecycle: build the protocol layer into a link-scoped `Scope` at open, close that scope at `dispose()` — the link face is Promise-shaped by contract — plus `duplexWireLink`'s construction of the socket from a node `Duplex`, which moved here from `links/stdio.ts` at juspay/kolu#2101 so the raw attach has no export subpath (the stdio and unix-socket legs are its only callers)",
  },
  {
    path: "packages/surface/src/mirrorRemoteSurface.ts",
    sites: 1,
    why: "the mirror's subscription runner — the mirror hands back a `done` Promise and takes an AbortSignal, both non-Effect by public contract",
  },
  {
    path: "packages/surface/src/peer-server.ts",
    sites: 2,
    why: "the stdio serve boundary: build the serving layer into a scope, close it at the end — `serveOverStdio` resolves a classified end and never rejects",
  },
  {
    path: "packages/surface/src/runStream.ts",
    sites: 2,
    why: "THE Solid bridge, and the package's ONE UI-tier fork: a member stream becoming a fiber with a synchronous stopper (which every `createSubscription` rides), plus `runDetached` for a cell write whose only launcher is a coalescing TIMER — there is no caller left to compose it into, and it is deliberately NOT scoped to the queuing owner, because a component unmounting inside the debounce window must still land the write",
  },
  {
    path: "packages/surface/src/server.ts",
    sites: 1,
    why: "one fiber per owned cell connector — a served surface's face is synchronous construction plus a Promise-shaped `done`/`close`, so this is where a connector's scoped Effect becomes a supervised fiber; it replaces `project.ts`'s three, which existed only because the connector seam was Promise/Disposer-shaped",
  },
  {
    path: "packages/surface/src/solid/liveSignal.ts",
    sites: 1,
    why: "the liveness heartbeat is framework-free and Promise-shaped (it races a probe against a timer) and is shared with non-Effect consumers",
  },
  {
    path: "packages/surface/src/unix-socket.ts",
    sites: 2,
    why: "the unix listener's per-peer boundary: serve each accepted connection in its own scope, release that scope on the socket's `close`/`error` — node `net` callbacks either side",
  },
  {
    path: "packages/tests/step_definitions/spawn_detection_steps.ts",
    sites: 4,
    why: "the cucumber steps' four boundaries — a scoped dial of the kaval daemon, the command-rooted spawn under test, and the kill + scope-close an `After` hook must complete before the world is torn down; a step body is a Promise the runner awaits, so there is no Effect above it to compose into",
  },
  {
    path: "packages/tests/support/rpcWire.ts",
    sites: 1,
    why: "the e2e harness's ONE wire edge — every suite call funnels through it, and it runs the EXIT (not the value) with the caller's timeout as an AbortSignal, because the harness classifies on the `Cause`: a padi still warming up is retried, not failed",
  },
];

const SKIPPED_DIRS = new Set(["node_modules", "dist", ".astro", ".vite"]);

const RUN_CALL = /\b(?:Effect|Runtime|NodeRuntime)\.run[A-Z][A-Za-z]*\s*\(/g;

const BARE_RUN_IMPORT =
  /import\s*\{[^}]*\brun[A-Z][A-Za-z]*\b[^}]*\}\s*from\s*["']effect[^"']*["']/;

const UNCALLED_RUN_REFERENCE =
  /\b(?:Effect|Runtime|NodeRuntime)\s*\.\s*run[A-Z][A-Za-z]*\b(?!\s*\()/g;

const DESTRUCTURED_RUN =
  /\{[^{}]*\brun[A-Z][A-Za-z]*\b[^{}]*\}\s*=\s*(?:Effect|Runtime|NodeRuntime)\b/g;

interface NonCodeSpan {
  start: number;
  end: number;
  kind: "comment" | "string";
}

function nonCodeSpans(source: string): NonCodeSpan[] {
  const spans: NonCodeSpan[] = [];
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const nl = source.indexOf("\n", i);
      const end = nl === -1 ? source.length : nl;
      spans.push({ start: i, end, kind: "comment" });
      i = end;
      continue;
    }
    if (two === "/*") {
      const close = source.indexOf("*/", i + 2);
      const end = close === -1 ? source.length : close + 2;
      spans.push({ start: i, end, kind: "comment" });
      i = end;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      spans.push({ start: i + 1, end: j - 1, kind: "string" });
      i = j;
      continue;
    }
    i += 1;
  }
  return spans;
}

function blank(source: string, spans: NonCodeSpan[]): string {
  const out = source.split("");
  for (const span of spans) {
    for (let j = span.start; j < span.end && j < out.length; j++) {
      if (out[j] !== "\n") out[j] = " ";
    }
  }
  return out.join("");
}

export function blankCommentsAndStrings(source: string): string {
  return blank(source, nonCodeSpans(source));
}

export function blankCommentsOnly(source: string): string {
  return blank(
    source,
    nonCodeSpans(source).filter((span) => span.kind === "comment"),
  );
}

export function countRunCalls(source: string): number {
  return (blankCommentsAndStrings(source).match(RUN_CALL) ?? []).length;
}

export function hasBareRunImport(source: string): boolean {
  return BARE_RUN_IMPORT.test(blankCommentsOnly(source));
}

export function findRunAliases(source: string): string[] {
  const code = blankCommentsAndStrings(source);
  return [
    ...(code.match(UNCALLED_RUN_REFERENCE) ?? []),
    ...(code.match(DESTRUCTURED_RUN) ?? []),
  ].map((text) => text.replace(/\s+/g, " ").trim());
}

function isScannedSource(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  return !/\.(test|test-d)\.(ts|tsx)$/.test(file);
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isScannedSource(entry)) out.push(full);
  }
}

export function scannedSources(repoRoot: string): string[] {
  const files: string[] = [];
  walk(path.join(repoRoot, "packages"), files);
  return files
    .map((f) => path.relative(repoRoot, f).split(path.sep).join("/"))
    .sort();
}

export function collectRunEdges(repoRoot: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of scannedSources(repoRoot)) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    if (hasBareRunImport(source)) {
      throw new Error(
        `${file} imports an Effect \`run*\` helper by bare name. Use the namespaced form (\`Effect.runPromise\`) so the run-edge allowlist can see it.`,
      );
    }
    const aliases = findRunAliases(source);
    if (aliases.length > 0) {
      throw new Error(
        `${file} names an Effect \`run*\` function without calling it (${aliases.join(", ")}). An alias can be invoked anywhere, so the allowlist could never see the edge — call it in place, or compose the effect into its caller.`,
      );
    }
    const count = countRunCalls(source);
    if (count > 0) found.set(file, count);
  }
  return found;
}

export function validateRunEdges(
  found: ReadonlyMap<string, number>,
  allowlist: readonly RunEdge[] = RUN_EDGE_ALLOWLIST,
): void {
  const allowed = new Map(allowlist.map((e) => [e.path, e.sites]));
  const problems: string[] = [];
  for (const [file, count] of [...found].sort()) {
    const expected = allowed.get(file);
    if (expected === undefined) {
      problems.push(
        `  + ${file} runs ${count} effect(s) and is NOT on the allowlist. If this is not a process/UI edge, compose the effect into its caller instead of listing it.`,
      );
    } else if (expected !== count) {
      problems.push(
        `  ~ ${file} runs ${count} effect(s); the allowlist says ${expected}.`,
      );
    }
  }
  for (const entry of allowlist) {
    if (!found.has(entry.path)) {
      problems.push(
        `  - ${entry.path} is allowlisted for ${entry.sites} run edge(s) but has none — drop the row.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Effect.run* edge allowlist is out of date (PLAN D10/#25):\n${problems.join("\n")}`,
    );
  }
}
