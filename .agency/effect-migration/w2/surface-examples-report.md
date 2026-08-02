# W2 fanout — the surface EXAMPLE trees on the Effect surface core

Scope: `packages/surface/example` (root notes app + `fleet-top/part-{1,2,3}` +
`mini-ci` + `snippets` + `remote-process-monitor`) and
`packages/surface-app/example`. Eight workspace packages, ~40 source files.
Zero `zod` / `@orpc/*` / `partysocket` imports remain anywhere in either tree.

These are the framework's **documented API surface** — 22 of these files (or
named `#region` blocks inside them) are embedded verbatim into
`website/src/content/surface/*.mdx` by the `<Snippet>` component. Every file
path and every region name is preserved, so no MDX page needs a co-edit to keep
rendering; what changed inside the regions IS the new documented usage.

Built against the committed core: S1 (`Surface {group, tagPrefix, spec}`, the tag
algebra, `WireSchema`), S2 (`SurfaceRuntime {group, handlers, ctx}`,
`StreamImplDeps.source: (input) => Stream`, `ProcedureImpl → Effect`,
`streamFromAbortableSource`), S3 (`SurfaceDispatch`, `buildSurfaceFace`,
`directDispatch`, `createLiveSignal(WireTransport)`, `unenrolledStreamCall →
Stream`), S4 (`stdioLink`/`unixSocketLink`/`websocketLink` async on `{group,…}`
→ `{dispatch, dispose}`), plus `@kolu/surface-app`'s `serveSurfaceSocket`,
`@kolu/surface-map`'s `{group, handlers}` + `EntrySession.dispatch`,
`@kolu/surface-remote`'s `sshConnector({surface, …})` / `AgentClient =
SurfaceFace`, and `@kolu/surface-daemon`'s `DaemonSpec {group, handlers}`.

---

## 1. ⚠ ONE package.json change, and why (PLAN standing rule 5 FIRES)

**`@kolu/surface-app` was added as a dependency of three example packages**:
`@kolu/surface-example`, `@kolu/surface-example-fleet-top-part-1`,
`@kolu/surface-example-fleet-top-part-3`.

This is not a convenience. Under oRPC these three served their browser leg with
`new WsRPCHandler(router)` + `wsHandler.upgrade(peer)` — two lines from a
package they already had. Effect RPC has no equivalent one-liner, and the
framework's serving seam for an ACCEPTED websocket — `serveSurfaceSocket({group,
handlers, socket})` — lives in `@kolu/surface-app` (surface-app §4), not in
`@kolu/surface`. The alternatives were both worse: hand-roll ~60 lines of
`RpcServer.layer` + one-connection `SocketServer` + inbound-frame buffering in a
TUTORIAL (and duplicate framework logic — the "reuse the existing source of
truth" rule), or leave three examples permanently red. The CLIENT side of all
three still needs no surface-app (it uses `websocketLink` + `createLiveSignal`
from `@kolu/surface`), and the files say so.

**Rule-5 disposition, checked rather than assumed:**

- `pnpm install` was run; the lockfile delta is **exactly three `link:` rows**
  (`+9 -0` lines, all `version: link:../../surface-app`). No tarball is added,
  removed, or re-resolved, so `nix/workspace.nix`'s `pnpmDeps` FOD hash should
  be unchanged — the same specifier-only shape W1.5 measured (§W1.5: "the
  lockfile moved; the FOD hash did not"). **I did not re-run the two-build
  `--rebuild` sequence** (it needs a network `nix build` and this worktree is
  shared with in-flight agents). **W6/W7 must run `just ci::pnpm-hash-fresh`
  once** — if it moves, the new hash goes in `nix/workspace.nix:178`.
- `default.nix` `stableLeaves` was re-checked: it guards the **kaval** and
  **padi** daemon closures. Neither daemon's closure contains an `example`
  package (they are `private: true` demos with no consumer), and the new edge is
  example → surface-app, a direction no daemon traverses. No `nix eval` delta is
  expected here.
- No other `dependencies` block changed. `zod`, `@orpc/*`, `partysocket` and
  `@orpc/experimental-publisher` remain DECLARED in the example manifests with
  zero imports left — W6's purge, per its brief.

**Framework observation for the reconcile pass** (not edited, not my package):
`serveSurfaceSocket` is a domain-agnostic transport capability — "serve a
`{group, handlers}` over an accepted duplex" — and sits beside `serveOverStdio`
/ `serveOverUnixSocket` conceptually while living one package up. If the
reconcile pass graduates it into `@kolu/surface` (say `@kolu/surface/ws-server`,
next to `ws-origin`), these three dependency edges disappear and the arrow
straightens.

---

## 2. What replaced what, across all eight packages

| was | is |
|---|---|
| `surface.contract` (oRPC router type) | `surface.group` (flat `RpcGroup`, one member per wire tag) |
| `implementSurface(...).router` | `runtime.group` + `runtime.handlers` — the pair EVERY transport takes |
| `new RPCHandler(router)` (HTTP arm) | **deleted** — Effect RPC speaks ndjson over ONE bidirectional transport, so a surface has a single browser leg (§3) |
| `new WsRPCHandler(router)` + `upgrade(peer)` | `serveSurfaceSocket({ group, handlers, socket })`, with `done` observed |
| `serveOverStdio({ router })` | `serveOverStdio({ group, handlers })` |
| `daemonMain({ router })` | `daemonMain({ group, handlers })` |
| `serveSurfaceMap(...).router` | `{ group, handlers, dispose }` |
| `MapRegistry.resolve → { kind:"session", link }` | `{ kind:"session", dispatch }` (a typed `SurfaceDispatch`) |
| `directLink<typeof surface.contract>(router)` | `directDispatch(runtime)` + `buildSurfaceFace(surface, dispatch)` |
| `new PartySocket(url)` + `createLiveSignal<C>(ws, {})` | `await websocketLink({group, url, isTerminalClose})` then `createLiveSignal(link, {})` — the WHOLE `{dispatch, wire}` pairing |
| `sshConnector<typeof surface.contract>({...})` | `sshConnector({ surface, ... })` — the surface as a VALUE |
| `AgentClient<typeof surface.contract>` | `AgentClient` (= `SurfaceFace`) |
| `async function* source(input, signal)` | `(input) => Stream`, with `streamFromAbortableSource` at a `Channel.subscribe` producer edge |
| `kill: async ({input}) => …` | `kill: ({input}) => Effect.sync(…)` / `Effect.promise(…)` |
| `for await (const f of await client.surface.x.get({}))` | `Stream.runForEach` / `Stream.runHead` / `Stream.takeUntil` |
| `AbortController` + `controller.abort()` for a TUI detach | fiber interrupt (a `runStream` stopper) |
| `z.object/enum/tuple/record/discriminatedUnion/...` | `Schema.Struct/Literals/Tuple/Record/Union/...` |
| `z.infer<typeof S>` | `typeof S.Type` (and `typeof S.Encoded` where a CALLER's side is meant) |
| `MemoryPublisher` (`@orpc/experimental-publisher`) | `inMemoryPublisher()` from `@kolu/surface/server` (PLAN D7 — kolu's own publisher is the source of truth) |

Two files were RENAMED because their name no longer described their content
(neither is referenced by a `<Snippet>` or by nix):
`surface/example/src/server/router.ts` → `serve.ts`, and
`remote-process-monitor/src/server/router.ts` → `serve.ts` (`buildRouter` →
`buildSurface`). Both example READMEs were updated to match.

One file was ADDED: `mini-ci/src/tui/members.ts` — see §5.

---

## 3. The HTTP RPC arm is DELETED, deliberately

Four example servers ran a second, HTTP transport (`@orpc/server/fetch`'s
`RPCHandler` behind `gateHttpRpcOrigin`) alongside the websocket. Effect RPC has
no HTTP-request/response arm in this stack: every call — a cell subscription, a
collection delta stream, an imperative procedure — rides the one ndjson socket.
So the arm is not "ported"; it has nothing left to serve, and keeping an empty
`/rpc/*` route would advertise a transport that answers nothing.

Consequence worth naming: **`gateHttpRpcOrigin` now has zero call sites in the
examples**, and its whole reason for existing was that oRPC's HTTP arm was
browser-reachable without a preflight. `gateWsOrigin` is still used by all five
servers and still load-bearing. If nothing in kolu's own server keeps the HTTP
gate after W4, `@kolu/surface/ws-origin` should shed it — recorded for the
reconcile pass, not acted on.

Also gone with it: every `biome-ignore lint/suspicious/noExplicitAny` that
existed to carry `router as any` past oRPC's `Router<any, T>` input type. There
are **no `as any` casts left in either example tree**; the two remaining casts
are `as unknown as ServableSocket` (a `ws` socket satisfies the seam
structurally, but its typings narrow `addEventListener` per event name) and the
member-face narrowings of §4 — each commented at the site.

---

## 4. Naming a structural face — the pattern the examples now teach

`SurfaceFace` is `{ surface: Record<string, Record<string, unknown>> }` by
design (S3 §1.1): per-member precision lives in the spec-derived bound hooks
`surfaceClient` builds, and a second precise mapped type over the same spec is
the union-budget blow-up D2 exists to avoid. A **reactive** consumer never sees
this — `app.cells.load.use()` is fully typed. A **non-reactive** consumer (a
CLI, a TUI, a supervisor `connect`, a re-serve forwarding a procedure) does, and
the examples now show the honest answer: **name the shape of each member you
call, once, at the top of the file**, after which every call site is typed.

```ts
const kill = client.surface.proc?.kill as UnaryProcedure<KillArgs, Killed>;
const nodeLog = client.surface.nodeLog?.get as StreamingProcedure<NodeIdArg, LogFrame>;
```

Which SIDE of the schema a name uses is the other half of the lesson, and it is
now spelled in the surfaces themselves: a procedure/stream INPUT is the
**encoded** side (`typeof KillInputSchema.Encoded`, `SurfaceTypes<…>["InputWire"]`),
because it is a pure argument the caller forwards; a result or a frame is the
**decoded** side. `fleet-top`'s `kill` makes this concrete — `signal` carries a
`withDecodingDefaultKey`, so the caller may omit it while the handler always
receives a real signal name.

`mini-ci` factors the same idea into a tiny module (`tui/members.ts`) because it
calls three members from four places; the smaller examples inline it.

---

## 5. Streams outside Solid — and a core ask this makes concrete

Every non-Solid consumer needs the same three things a `Stream` does not give a
callback-shaped program for free: run it, stop it, and read only its first
frame. The examples now use:

- **`Stream.runHead`** for a one-shot snapshot read (a cell `get`, a collection
  `keys`, a present-key item `get` all OPEN with the snapshot, so the head IS
  the snapshot — and running the head interrupts the subscription as soon as it
  lands). This replaces `firstFrameOrThrow` at five sites.
- **`Stream.runForEach` + `Stream.takeUntil`** for "consume until a condition",
  replacing `for await … break`. The `takeUntil` end finalizes the
  subscription — the Stream-native `break`.
- **A `runStream(stream, handlers) → stopper`** for a long-lived push
  subscription with a teardown handle, replacing `AbortController.abort()`.

**`@kolu/surface/first-frame` is dead for a Stream-shaped face.**
`firstFrameOrThrow` / `firstFrameOrUndefined` / `firstFrameOfCollectionItem`
still take `AsyncIterable`, which no member ref returns any more. surface-mcp's
report already asked the reconcile pass to graduate a Stream-native twin; this
pass is the second consumer to need it (five call sites), and `kaval-tui` /
`padi-tui` will be the third and fourth in W5. **Please graduate
`firstFrameOrThrow`/`firstFrameOfCollectionItem` onto `Stream`** — with the
absent-key bound `firstFrameOfCollectionItem` exists for, which `Stream.runHead`
alone does NOT provide (a not-yet-member item `get` still hangs).

**`runStreamScoped` still has no non-Solid subpath.** `src/runStream.ts` lives
at the package root precisely because it has nothing to do with Solid, but it is
only re-exported through `@kolu/surface/solid` — which a node package cannot
import without dragging `solid-js` in. `mini-ci/src/tui/members.ts` therefore
restates its three rules (~30 lines: the stopper latches before interrupting, an
interruption is not a failure, nothing reports after the stop).
**`@kolu/surface-remote`'s report asked for `"./run-stream": "./src/runStream.ts"`
for exactly this reason; this is the second package paying for its absence.**
Adding the subpath deletes both copies.

---

## 6. A real race the port exposed, fixed in the TEST rather than papered over

`mini-ci.test.ts`'s harness did `h.track()` (subscribe) then `h.start()` (run
the pipeline) and asserted the tracker saw the transitions. That sequencing
assumed the wire subscription was live the instant `runStream` returned. It
never was — under oRPC it merely happened to win the race, and under Effect RPC
a ONE-task pipeline (`echo build`, ~6 ms) reliably completes before the server's
handler has read its snapshot, so the tracker's snapshot frame arrived already
`ok` for the 3-task cases and the transition was simply missed for the 1-task
ones. Two tests hung out to their 4 s `until` deadline.

The fix is the discipline the framework itself teaches: **subscribe, THEN act.**
`track()` now returns a `ready` promise resolved by its first (snapshot) frame,
and every test awaits it before `h.start()`. That removes the race rather than
tolerating it, the suite went from 8/10 in 8.5 s to **10/10 in 0.5 s**, and the
harness now demonstrates the ordering rule instead of quietly depending on luck.
(The tracker also grew a loud `onFailure` — the previous silence is exactly the
`caught-error-must-not-collapse-to-empty` shape: a failed subscription looked
identical to a slow one.)

**This is a test-side fix, not a framework finding.** The window is inherent to
any publish/subscribe system where work starts before the subscriber attaches;
S2 §2 already records that `Stream.concat` makes the server-side window
*narrower* than the generator's was.

---

## 7. zod → Effect Schema, per file

| site | before | after |
|---|---|---|
| `z.string()` / `z.number()` / `z.boolean()` | — | `Schema.String` / `Schema.Number` / `Schema.Boolean` |
| `z.number().int().nonnegative()` | — | `Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))` |
| `z.number().int().min(10).max(32)` | — | `Schema.Int.check(Schema.isBetween({minimum:10, maximum:32}))` — note the OPTIONS object, not two positional args |
| `z.string().min(1)` | — | `Schema.String.check(Schema.isMinLength(1))` |
| `z.array(X).min(1)` | — | `Schema.Array(X).check(Schema.isMinLength(1))` |
| `z.enum([...])` | — | `Schema.Literals([...])` |
| `z.tuple([a,b,c])` | — | `Schema.Tuple([a,b,c])` |
| `z.record(K, V)` | — | `Schema.Record(K, V)` |
| `z.discriminatedUnion("kind", [...])` | — | `Schema.Union([...])` — **not** `TaggedUnion` (the discriminant is `kind`, not `_tag`; a tagged union would rename it and change the bytes) |
| `z.number().int().nullable()` | — | `Schema.NullOr(Schema.Int)` |
| `.optional()` | — | **`Schema.optionalKey`** (#17 law) |
| `.default(v)` | — | **`Schema.withDecodingDefaultKey(Effect.succeed(v))`** (#17 law) |
| `EditorPrefsSchema.partial()` | — | an explicit `Schema.Struct` of `optionalKey` fields over the SAME named field schemas (Effect Schema has no `.partial()`; naming the fields is what keeps value and patch from drifting) |
| `PipelineSpecSchema.parse(raw)` | — | `Schema.decodeUnknownSync(PipelineSpecSchema)` built ONCE at module scope |
| `z.infer<typeof S>` | — | `typeof S.Type`, or `typeof S.Encoded` where the CALLER's side is meant |

**No byte-compat hit-list format lives in these packages** (`recon/zod.md`:
"No compat risk (demo apps)"), so no byte-level fixture tests were added here —
the hit-list formats they *ride* (`collectionDeltasSchema`, the fold envelope,
`ConnectionInfoSchema`) are pinned in the framework packages that own them. The
#17 law is nonetheless stated in the header of every example surface file, since
these files are what a new spec author copies.

The four `Schema.Record`/`Schema.Array`/`Schema.Tuple` Type sides are `readonly`
where zod's were mutable; that rippled into a handful of local annotations and
nothing else.

---

## 8. Per-package notes

**`packages/surface/example` (the notes app).** Publisher swapped to
`inMemoryPublisher` (D7). The `autosave` event's domain-managed channel is now
bridged with `streamFromAbortableSource` — the one sanctioned AbortSignal→Stream
conversion, and a good place for a reader to meet it. `search` became
`Stream.suspend(() => Stream.succeed(...))`, so the search still runs per
subscription.

**`fleet-top/part-1`.** `inproc.ts` (embedded WHOLE in `your-first-surface.mdx`)
is the biggest teaching change: `directLink<contract>(router)` → `directDispatch`
+ `buildSurfaceFace`, with a 7-line local `snapshot()` over `Stream.runHead` and
one named member shape per read. It is longer than it was, and honestly so — the
old one-liner was hiding the face's structural nature behind a contract generic
that no longer exists.

**`fleet-top/part-2`.** `daemonMain({ group, handlers })`; `connectTop` dials
with `dialSocket` then `await stdioLink({group, read, write})` and disposes the
LINK before the socket (its scope holds the protocol's fibers — dropping the
socket alone leaks them). `TopClient` is `SurfaceFace`.

**`fleet-top/part-3`.** `HostBinding.link: unknown` → `dispatch:
SurfaceDispatch`; the registry resolves `{kind:"session", dispatch, state}`.
`kill` forwards through `Effect.promise` (not `tryPromise`): the procedure
declares no error channel, so a link gap is UNDECLARED and must stay a loud
defect, not something a browser could narrow on and swallow. The `dial` and
`pump` regions the docs embed keep their names and their shape.

**`mini-ci`.** The runner's `nodeLog` stream is
`Stream.suspend → Stream.concat(snapshot, streamFromAbortableSource(bus))`,
preserving snapshot-then-deltas ordering exactly. The TUI's detach is a fiber
interrupt. `tui/members.ts` is new (§4/§5). The test suite is 10/10 (§6).

**`snippets`.** All 22 embedded regions preserved by name. `consume-cli.ts`
gained the `Stream.runHead` / `runForEach` / `unenrolledStreamCall`-returns-a-
Stream story; `links.ts` and `consume-solid.ts` show `connectSurface` as ASYNC;
`daemon.ts`'s `control-core` region hands `daemonMain` the `{group, handlers}`
pair; `supervisor.ts` builds its face from `composeSurfaceContracts(...)
.siblings.app` (the sibling `Surface` already carries its `surface/app/` prefix,
so the face never learns it is scoped — a nice demonstration of S1's per-sibling
re-walk).

**`remote-process-monitor`.** The parent's re-serve is the same shape, now on
`{group, handlers}` + `serveSurfaceSocket`. `App.tsx`'s `app.rawStream` names its
member shape (§4). The bridge's comment about "the `ClientRetryPlugin` is not
load-bearing" was rewritten to the true reason: no link retries a CALL (the fence
is the face's job) and a stdio leg never reconnects its transport at all.

**`packages/surface-app/example`.** `composeSurfaceContracts(surfaces)` is now
`composed` (its `.group` is what the link is built over). The server gained
`acceptSurfaceSocket` — it previously had NO stale-tab gate at all, and adding it
is what makes `isStaleProcessClose` on the client half meaningful (a 4001 close
now really happens, the link retires, and the tab settles instead of storming).
`surfaceAppServer` is called exactly ONCE and its `processId` feeds both the gate
and the `identity.info` probe — a second call would mint a second id and every
reconnecting tab would read as stale. `<SurfaceAppProvider ws={ws}>` →
`wire={link.wire}`.

---

## 9. Deviations / deliberate residue

1. **`@kolu/surface-app` added to three manifests** — §1, with the rule-5
   accounting and the graduation ask.
2. **The HTTP RPC arm deleted rather than ported** — §3. It has no Effect
   counterpart in this stack; keeping a dead route would be worse than removing
   the demonstration of `gateHttpRpcOrigin`.
3. **`just fmt` was NOT run repo-wide.** `just fmt` is `biome format --write .`,
   and four `packages/surface/src/*` files are dirty in this worktree from
   another in-flight agent. Ran `biome format --write` scoped to
   `packages/surface/example` + `packages/surface-app/example` instead, then
   verified `biome format` reports clean over both. Same call S3/S4/surface-app/
   surface-daemon/surface-remote made, same reason. No `.nix` file changed, so
   `nixpkgs-fmt` is moot.
4. **Two `router.ts` files renamed to `serve.ts`** — neither is `<Snippet>`- or
   nix-referenced; both READMEs updated in the same commit.
5. **One `as unknown as SurfaceClientCallable` in `snippets/mcp.ts`.**
   `surface-mcp`'s `SurfaceClientCallable` types member leaves as functions while
   `buildSurfaceFace` types them `unknown`; the two describe the same runtime
   value. surface-mcp's own tests use the identical cast, so this is the current
   idiom rather than my invention — but a cast in a DOCUMENTED snippet is a smell.
   **Reconcile ask: make `SurfaceClientCallable` accept a `SurfaceFace`** (leaves
   `unknown`, narrowed internally where surface-mcp already narrows), and the cast
   and its four-line apology disappear.
6. **`packages/surface/example/README.md`'s primitive table still names the
   pre-bound-hook API** (`useCell(prefsCell, …)`, `cellHandlers`). That drift
   predates this migration — the code has used `app.cells.prefs.use()` for
   several releases — so I fixed only the file PATHS the rename moved and left
   the table for whoever owns the README refresh. Flagging it rather than
   silently half-fixing it.
7. **No Reference-page (`website/src/content/surface/ref-*.mdx`) edits.** These
   packages export nothing; the API breaks they CONSUME belong to the seven
   framework packages, whose reports are the changelog W6's docs pass drains.
   The `<Snippet>`-embedded regions — which are the parts of those pages that
   show real code — all move with this commit by construction.

---

## 10. Gates

```
pnpm --filter "@kolu/surface-example*" --filter "@kolu/surface-app-example" typecheck
  → 8 packages, ZERO errors (tsc 7.0.2 / 5.8 per package)

pnpm --filter @kolu/surface-example-mini-ci test:unit
  → 1 file, 10 tests, ALL GREEN (was 8/10 + 2 timeouts on first port — §6),
    8.5s → 0.5s

pnpm --filter "@kolu/surface-example*" build:client     → 4 clients built
pnpm --filter @kolu/surface-app-example build:client    → built
  (both CI lanes; vite 8.1, target esnext — the top-level `await websocketLink(...)`
   in each `wire.ts` builds clean)

biome lint --error-on-warnings packages/surface/example packages/surface-app/example
  → clean, 103 files
biome format packages/surface/example packages/surface-app/example
  → clean, 98 files (scoped write — §9.3)

grep for `from "zod"` / `from "@orpc/` / `from "partysocket"` across both trees
  → NO hits
```

---

## 11. Nothing here invalidates a PLAN assumption — with four asks

- **D2 holds, and the examples now TEACH it**: the face is structural, the bound
  hooks are spec-typed, and a non-reactive consumer names what it calls (§4).
- **D3 holds**: `unenrolledStreamCall`'s fence is shown with its `onRetry`, and
  the snapshot-then-deltas authoring shape (`Stream.suspend` → `Stream.concat`)
  is used by both stream-serving examples.
- **D4 holds**: every example procedure that can't declare an error uses
  `Effect.sync`/`Effect.promise`, so an undeclared failure stays a DEFECT; the
  two forwarding procedures say so in a comment at the site.
- **D5 holds**: the browser leg is `websocketLink` + `serveSurfaceSocket`, with
  surface-app supplying `isTerminalClose` (#5) and the ws-origin gate still in
  front of the upgrade (#6).
- **D7 holds**: `MemoryPublisher` is gone; `inMemoryPublisher` is the one
  publisher.
- **D10 holds**: no `AbortSignal` remains on any member source or any consumer
  loop in either tree. The residuals are `streamFromAbortableSource`'s own
  producer-edge controller (the sanctioned bridge) and
  `MirrorRemoteSurfaceOptions.signal` (the core's own non-Effect vocabulary).
- **#17 is stated as law in every example surface file's header**, since these
  files are what a new spec author copies.

**Four asks of the reconcile pass / W6, in priority order:**

1. **Add `"./run-stream": "./src/runStream.ts"`** to `@kolu/surface`'s exports —
   asked for by `@kolu/surface-remote` and now by `mini-ci`; deletes three
   hand-copies of the same 30 lines (§5).
2. **Graduate `firstFrame*` onto `Stream`** — `firstFrame.ts` is unreachable from
   any current face, and the bounded `firstFrameOfCollectionItem` has no
   `Stream.runHead` substitute (§5). `kaval-tui`/`padi-tui` need it in W5.
3. **Make `surface-mcp`'s `SurfaceClientCallable` accept a `SurfaceFace`** —
   removes a cast from a documented snippet (§9.5).
4. **Consider graduating `serveSurfaceSocket` into `@kolu/surface`** — removes
   three example→surface-app dependency edges and straightens the arrow (§1).
