# W5 — `kolu-client` on the Effect client tier

Scope: the whole browser SPA. `src/wire.ts` (the transport + face assembly),
`src/rpc/` (lifecycle, two NEW modules, one DELETED), the three `ORPCError`
narrowing sites, `sessionTransfer`/`deepLink`/`attentionNotify`/`visitRecency`/
`commands` (zod `.safeParse` → Effect `Result`), the AbortSignal fallout
(`reattachingStream`, `createPolledQuery`'s call sites, `codeTabOpenController`),
the readonly fallout, and — the part that was not on the brief — a sweep for the
#17 explicit-`undefined` landmine, which found **four live crashes** (§4).

Zero `zod` / `@orpc/*` imports remain in `src/`.

---

## 1. `wire.ts` — the four shape changes

### 1.1 `connectSurfaces` is async, so the module is

`connectSurfaces` returns a `Promise` now (surface-app break 1 — the dial is an
effect). Every export in this module is derived from what it returns, and ~40
call sites import those exports as ordinary module constants. The choice was
between a **top-level `await`** here or teaching every consumer that `padiMap`
might not exist yet; the second is not a port, it is a redesign of the whole app's
initialisation, and it would put a "not ready" state into 40 files to model a
window that lasts one microtask.

So: `const conn = await connectSurfaces({...})`. Three things make that safe
rather than clever, and they are worth stating because a reviewer's first
reaction is "top-level await in the app's hub module?":

- **It does not wait for the socket.** `websocketLink` constructs the socket
  inside an `Effect.acquireRelease` and lets the protocol's own fiber retry the
  dial; the promise settles as soon as the protocol layer is built. A server that
  is down does not stall the module graph.
- **It cannot deadlock.** A TLA module deadlocks only inside an import CYCLE, and
  biome's `noImportCycles` runs `--error-on-warnings` over this package — the
  graph is provably acyclic (it is the same rule the `wire → hostScopes →
  activeWire` note in this file has always leaned on).
- **The build tolerates it.** `build.target: "esnext"`; `pnpm --filter
  kolu-client build` is green (§6).

### 1.2 The root procedures get a hand-written face — `src/rpc/rootProcedures.ts` (NEW)

`SurfacesConnection` no longer carries a typed nested link (surface-app break 3):
the sibling surfaces reach their members through the spec-derived bound faces, and
the combined dispatch is `conn.transport.dispatch`. But kolu multiplexes SEVEN
root procedures on the same wire (`server/info`, `daemon/restart`, five
`hosts/*`), which are plain `Rpc`s in `kolu-common/contract`, not surface members
— nothing walks a spec for them.

`rootProcedures(dispatch)` re-mints exactly the nesting the call sites already
read (`client.server.info()`, `client.hosts.add({ host })`), from the contract's
own schemas. It is `buildSurfaceFace` one size smaller: a tag-addressed unary ref
per member, `Promise` at the leaf (the sanctioned `Effect.runPromise` edge), typed
by hand because a dynamically-assembled `RpcGroup` carries no trustworthy type
information (D2/#16).

**Wrong tags are unspellable**: every tag is typed `(typeof ROOT_RPC_TAGS)[number]`
— kolu-common's own literal tuple — so a typo, or a tag kolu-common stops
declaring, is a compile error here instead of a 404 at the first call. That is
strictly better than the runtime `requests.has()` assertion it replaces the need
for.

**One cast**, in one helper, with the reason in the docstring: `dispatch.unary` is
`unknown → unknown` by design, and this is where the hand-written types meet the
erased seam — the same place `buildSurfaceClient` casts its assembled record to
`BoundProceduresFor<S>`.

### 1.3 `ws` → `wire`, and the e2e hook changes shape

`export { ws }` is gone; `export const wire: WatchableWire = link.wire`. The only
consumer was `rpc/rpc.ts`, which now passes `{ wire }` to `createServerLifecycle`.

`window.__koluWs = ws` becomes **`window.__koluWire`**, exposing the
`WatchableWire` (`status()` / `onStatus` / `forceReconnect()`). It is a RENAME, not
a shim, because the old contract no longer exists as a transport state:
partysocket's `close()` halted auto-reconnect until `reconnect()`; the Effect link
owns its retry schedule and always re-dials. **W7 hand-off (loud):**
`packages/tests/step_definitions/reconnect_steps.ts` drives `__koluWs?.close()` /
`?.reconnect()` and asserts the header dot reaches `closed` and stays there. Both
verbs are gone and the drop is now momentary, so that harness needs a rewrite —
the same class of change D6/#1 called out for `previousRelease.e2e.test.ts`.
Renaming rather than keeping `__koluWs` is deliberate: the optional-chained steps
would have silently no-op'd against a wrongly-shaped object and failed later, at
the assertion, pointing at the product.

### 1.4 `viewerMode.set` — one narrowed write ref

`client.surface.kolu.viewerMode.set(...)` had no successor: `app.rpc` is the
structural `SurfaceFace` (D2), and `procedureCastGuard.test.ts` forbids recovering
a callable by casting `.rpc`. `wire.ts` now exports
`setViewerMode: UnaryProcedure<ViewerMode, void>`, minted once by a local
`unaryMember(face, member, verb)` that THROWS if the surface carries no such
member — the `surfaceAppProbe` pattern, and the one sanctioned way to read a
member off the structural face. The cast is inside that helper, guarded by a
`typeof === "function"` check, so it is a narrowing rather than an assertion.
`useColorScheme` calls `setViewerMode(...)` and no longer knows a wire exists.

---

## 2. The declared-error vocabulary — `src/rpc/declaredErrors.ts` (NEW)

Three sites branched on an `ORPCError` code. They now branch on a `_tag`, through
one module that holds the two rules they share:

| site | was | is |
|---|---|---|
| `terminal/useTerminals.ts` exit-stream `onError` | `NOT_FOUND` swallow | `TERMINAL_NOT_FOUND` |
| `right-panel/hostCodeTab.ts` `branchStatus.onError` | `PRECONDITION_FAILED` swallow | `WORKTREE_BASE_BRANCH_MISSING` |
| `right-panel/hostCodeTab.ts` `fileContent.swallowError` | `NOT_FOUND` swallow | `FILE_GONE` |
| `terminal/Terminal.tsx` backfill (NEW required option) | — | `TERMINAL_NOT_FOUND` |

- **`isDefinedError` first** (from `@kolu/surface/solid`, which now owns it), so a
  transport drop is never branched on as an application outcome.
- **`_tag` compared STRUCTURALLY, never `instanceof`.** Two of these read a value
  that crossed a wire hop, where class identity may differ; and on the two
  per-terminal STREAM members padi states the asymmetry outright — a `StreamSpec`
  carries no error channel, so `TerminalNotFound` arrives as an UNDECLARED failure,
  a bare defect rather than a decoded instance. This is padi's own precedent
  (`terminalEndpoint/reattachingDeltas.ts`'s `isPtyNotFound`), reused not
  re-derived.
- The tags are LITERALS typed against the classes' own `_tag`
  (`const FILE_GONE: FileGone["_tag"] = "FileGone"`), so a rename in
  `@kolu/padi/surface` is a compile error here — the property the magic-code
  compare never had, and cheaper than padi's sentinel-instance trick.

**Cross-package finding (not fixed here — padi is another agent's package).**
`padiSurface.procedures.git.getStatus` declares `error: FsGitReadErrorSchema`
(`FileGone | GitFailed`), but its handler can raise **`WorktreeBaseBranchMissing`**:
`getStatus(repo, "branch")` → `resolveBase` → `BASE_BRANCH_NOT_FOUND` →
`unwrapGit` → that class. Under oRPC it travelled as `PRECONDITION_FAILED`, which
is exactly what the Code tab's passive branch read swallows. So either the
declaration should gain the arm, or the failure will cross as a defect. The
client's structural `_tag` narrow works for BOTH readings, which is the other
reason it is structural — but the declaration gap is real and should be closed in
padi.

## 2.1 `safe` / `isDefinedError` in their new shapes — `kaval/useDaemonRestart.ts`

`const { error } = await safe(...)` no longer type-checks: `SafeResult` is a
three-arm discriminated union on `declared`. The port reads

```ts
const result = await safe(activePadiRpc.lifecycle.recycleKaval());
if (result.ok) …
else if (result.declared && result.error._tag === "KavalContractSkew") …
else … // result.error is honestly `unknown`
```

`declared` is a STRUCTURAL classification (it means "tagged, and not a transport
error"), so the `_tag` compare is a real runtime guard, not a formality — kept for
that reason even though the procedure declares exactly one error. The `else` arm
normalises before reading `.message`, because on that arm the value genuinely is
`unknown`.

---

## 3. The AbortSignal seam (D10/#18) — where the signal went, and where it stayed

**Deleted: `src/rpc/streamCleanup.ts`.** `isExpectedCleanupError` classified the
`DOMException("AbortError")` an unmount produced on an async iterator. Teardown is
a fiber interrupt now and `runStreamScoped` reports NOTHING once its stopper has
run, so the unmount can no longer reach a failure handler at all. Both call sites
lose the guard rather than keeping a predicate that can never match.

**`terminal/reattachingStream.ts` rewritten on `runStreamScoped`.** Same contract
— graceful end does not re-attach, an abnormal end resets + re-subscribes after a
300ms backoff, `signal` ends the loop — with the `for await` loop replaced by a
re-arming `runStreamScoped` call. `streamFn` is still re-entered per attempt (that
is what lets Terminal.tsx re-read the live grid). The caller's `AbortSignal`
stays: it is the non-Effect vocabulary of the attempt supersession in Terminal.tsx,
translated into one interrupt here, at the edge — exactly the shape
`mirrorRemoteSurface` kept for the same reason.

**`unenrolledStreamCall` / `createReactiveSubscription` call sites** (Terminal
attach, `createHostWire`, `fleetTerminals`, `HostDiagnosticsPopover`,
`createPolledQuery`'s pulse) drop `{ signal }` and the source's second parameter.

**`createPolledQuery` keeps its `signal`**, and that is not an oversight: its
`query` is a caller-supplied Promise, `pollOnChange` still discards a superseded
read by it, and S3 kept the same seam for the same reason. What changed is that no
padi call receives it any more.

**`codeTabOpenController.readFresh` LOSES its signal.** Keeping the parameter
would promise a cancellation no implementation can honour. Supersession was
already decided by the controller's own `isCurrent` gate, so nothing weakened; the
two tests that asserted `signal.aborted` now assert the OUTCOME (a late answer
owns nothing), which is the stronger, mechanism-independent form.

**`CodeTab`'s lazy-directory `AbortController` stays** — it was already documented
as client-side-only supersession, and now it is unavoidably so.

---

## 4. #17 — four explicit-`undefined` landmines, all of them live crashes

This is the finding worth the most attention. `Schema.optionalKey` accepts an
ABSENT key and REJECTS a present-but-`undefined` one, where zod's `.optional()`
took either. The bound face DECODES its input at the edge
(`Schema.decodeUnknownSync`), so a violation is a SYNCHRONOUS THROW at the call
site — not a rejected promise, not a server-side 400. Four sites did it, three on
paths a user hits in the first ten seconds:

| site | field | when it fires |
|---|---|---|
| `terminal/useTerminalCrud.ts` `lifecycle.create({ cwd })` | `cwd` | every `Cmd+T` with no cwd — i.e. the ordinary create |
| `terminal/useTerminalCrud.ts` `lifecycle.create({ cwd, parentId })` | `cwd` | every split with no inherited cwd |
| `terminal/Terminal.tsx` `screen.history({ …, epoch })` | `epoch` | the first backfill fetch after any attach whose snapshot had no `reflowEpoch` |
| `terminal/useSessionRestore.ts` `session.restore({ optOutIds: … ?? undefined })` | `optOutIds` | every restore with no opt-outs |

All four now SPREAD the key (`...(cwd !== undefined && { cwd })`), each with the
rule stated at the site. `right-panel/useRightPanel.ts`'s `chrome.setRightPanel`
had the same shape for `selectedFileByMode` and is fixed the same way.

Swept and CLEAN: every other `activePadiRpc.*` / `app.procedures.*` call site
(their inputs carry no `optionalKey` field), and every `updatePreferences` caller
(all pass concrete values into `PreferencesPatch`).

`sessionTransfer.parseSavedSession` needed NO strip pass, and the reason is
written into the docstring rather than guarded: its input is `JSON.parse` output,
where `undefined` is unrepresentable, and every `backfillSavedSession` transform
either adds a key with a defined value or passes the record through. A strip pass
there would be dead code pretending to hold a line the input shape already holds.

---

## 5. The rest, briefly

**zod `.safeParse` → `Schema.decodeUnknownResult` + `Result.isFailure`** at four
read boundaries (`attentionNotify`, `deepLink`, `visitRecency`, `sessionTransfer`),
each as a module-level decoder const — padi's own idiom. Every one is a BRANCH
(drop the row / reject the link / reject the import), never a throw, which is what
the zod call did.

**`commands.tsx`'s `validateWorktreeName`** stops decoding a schema to read
`issues[0].message` and instead runs `kolu-git`'s exported `isValidWorktreeName` +
`WORKTREE_NAME_MESSAGE` — which are the very things `WorktreeNameSchema`'s check
is built from, and are exported with a comment saying they exist "so the client
can run the same predicate live in the worktree-naming palette leaf". One source
of truth for the rule; the palette owns its own sentence for the empty case
(the schema states that as a bare min-length, whose rendered `SchemaError` prose
is not something to show a user mid-typing).

**`HostKeySchema.parse` → `decodeHostKeyValue`** (kolu-common's one re-validation
entry) at six sites in `HostSelectorStrip.test.ts`.

**readonly fallout — rebuilt, never cast.** `recentRepos`/`recentAgents`,
`boundHostKavals`/`boundHostPadis`, `localScanKavals`/`localScanPadis` return
`readonly T[]`; `agentItems`/`worktreeAgentOptions` and `mergeGitStatusEntries`
widen their parameters to `readonly` (the latter gained a named structural
`GitStatusFile` type so a decoded row satisfies it directly);
`ScopedCodePaths.paths` is `readonly string[]` because it IS the decoded wire
array. `useRightPanel.setSelectedFile` stopped being a `produce` mutator and
became a shallow patch that REBUILDS the map — which is also what makes its
deselect arm drop the key instead of writing `undefined` into it (§4).

---

## 6. Gate

```
pnpm --filter kolu-client typecheck            → ZERO errors
pnpm --filter kolu-client test:unit            → 147 files, 1234 tests, ALL GREEN
biome lint --error-on-warnings packages/client → clean (512 files)
biome format --write packages/client           → applied (scoped, see §7.3)
pnpm --filter kolu-client build (in the devShell) → ✓ built in 5.20s
grep for `@orpc` / `zod` / `partysocket` imports in src/ → NONE
```

Test-file deltas (nothing deleted; one law restated):

| file | note |
|---|---|
| `terminal/reattachingStream.test.ts` | the async-iterable fixture became a `Stream` one. The "expected cleanup error" case is REPLACED by "abort mid-stream → the loop stops silently": there is no such error to classify any more, and the successor pins the property that replaced it. The backoff test drops `vi.useFakeTimers()` — the attempt runs on an Effect fiber whose scheduler fake timers do not drive, so faking time stalled the very failure that arms the backoff. |
| `right-panel/streamMock.testlib.ts` | `makeAbortAwareStream` → `makeControllableStream`: a `Stream.callback` queue, with an `onTeardown` finalizer replacing the abort listener (which is how `hostCodeTab.test.ts` retires a superseded pulse subscription). Pushes made before the fiber subscribes are buffered and replayed, so a fixture never races the scheduler. |
| `hostScope/mockHostMap.testlib.ts` | the mock `terminals.unenrolledKeys` is `Stream.never` — it must not END, or the retained sub would latch `complete`, a different fact from the lifecycle these tests pin. |
| `terminal/useTerminalMetadata.test.ts` | same, in its own `vi.mock` factory. |
| `right-panel/codeTabOpenController.test.ts` | two `signal.aborted` assertions became outcome assertions (§3). |
| `host/HostSelectorStrip.test.ts` | `HostKeySchema.parse` → `decodeHostKeyValue`. |

---

## 7. Deviations / deliberate residue

1. **`package.json` untouched** (W6 owns dep removal), so `@orpc/client`,
   `@orpc/contract` and `partysocket` remain DECLARED while zero source files
   import them. `effect` and `@effect/platform-browser` were already declared, so
   **no new dep was required** and PLAN standing rule 5 does not fire.
2. **`window.__koluWire` breaks `reconnect_steps.ts`** — stated loudly in §1.3 and
   in a code comment at the site. `packages/tests` is not this package.
3. **`biome format` was scoped to `packages/client`**, not run repo-wide via
   `just fmt`: sibling W5 agents are editing other packages in this worktree, and
   a repo-wide write would touch their in-flight files. Same call S4, surface-app
   and common made.
4. **The padi `git.getStatus` error-declaration gap** (§2) is reported, not
   patched — `packages/padi` is not this package.
5. **`createPolledQuery`'s public `query(input, signal)` signature is unchanged**
   even though no call site forwards the signal to a padi call any more. It is
   `pollOnChange`'s own supersede token and the framework still passes it; removing
   it here would fork the client's shape from the framework's for no gain.

## 8. Nothing here invalidates a PLAN assumption

- **D2/#13** holds at the app tier: procedure/stream inputs are consumed on the
  Encoded side, the root face hand-types the same way the bound faces are
  spec-typed, and `.rpc` is reached only through a fail-loud narrowing helper.
- **D4** holds: every `ORPCError` code compare is a `_tag` compare behind
  `isDefinedError`, and the two undeclared-on-a-stream cases are matched
  structurally for the reason padi documented.
- **D10/#18** holds: the client's remaining `AbortSignal`s are exactly the
  non-Effect consumer vocabulary (attempt supersession, polled-query supersede,
  a controller's own attempt token), each translated into an interrupt at one
  edge; no padi call carries one.
- **#17** is enforced at five call sites and swept across the package — and it was
  not a formality here: four of the five would have thrown on ordinary user
  actions.
