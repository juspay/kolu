# W5 — `kaval-tui` on the Effect client tier

Scope: the whole package (11 source files + 8 test files, one file added).
`package.json` unchanged — `effect` and `@effect/platform-node` were already
declared, so PLAN standing rule 5 does not fire. Zero `zod` / `@orpc/*` imports
existed before and none exist now; what changed is the *shape* of the surface
client this CLI has always consumed.

---

## 1. The shape change, in one table

`kaval-tui` is one of the four packages `recon/consumers.md` called "zero-cost
— proof the framework abstraction holds". That verdict survives: no command's
logic moved, no output byte changed, and every wire touchpoint is still a
`client.surface.<member>.<verb>` call. What moved is underneath.

| | before (oRPC) | now |
|---|---|---|
| `connectPtyHost` | `unixSocketLink<contract>({socketPath}) → { client, dispose }` | `unixSocketLink({group, socketPath}) → { dispatch, dispose }`, then `ptyHostClientOver(dispatch)` |
| `PtyTuiClient` | `UnixSocketConnection<typeof ptyHostSurface.contract>["client"]` | `PtyHostClient` = kaval's spec-derived face |
| `Connection.dispose` | `() => void` | `() => Promise<void>` |
| a procedure | `(input) => Promise<Out>` | same, but `input` is the **Encoded** side |
| a stream member | `await X.get(input, {signal}) → AsyncIterable<T>` | `X.get(input) → Stream<T>`, synchronous and lazy |
| dead-transport test | `err.code === SURFACE_STDIO_TRANSPORT_CLOSED` | `isDeadTransportError(err)` (`@kolu/surface/errors`) |
| `--host` dial | `dialAgentOnce<typeof …contract>({host,…})` | `dialAgentOnce({ surface: ptyHostSurface, … })`, face rebuilt from `dial.dispatch` |

`PtyTuiClient` is now an alias of kaval's `PtyHostClient` rather than a
re-derivation from the transport's return type. Deliberate: the face is a
property of the SURFACE, not of the link, and kaval already owns the one cast
that mints it (`ptyHostClientOver`). Re-deriving it here would have been a
second place for the spec-to-face projection to drift — the exact thing the
kaval report asks consumers not to do.

## 2. `src/stream.ts` (NEW) — the package's one `Stream` → pull bridge

Three call sites needed the same two facts, so they live in one leaf instead of
three copies:

```ts
subscribe<T>(stream: Stream<T, unknown>, signal?: AbortSignal): AsyncIterableIterator<T>
```

- **Subscribing is pulling.** A `Stream` value registers nothing; the producer
  starts on the first `next()`. Under the oRPC identity link that hop happened
  inside `await client.<member>.get(...)`, which is why the laziness was
  invisible — the same lesson kaval's `subscribeFrames` records. `attach`'s
  first-frame guard IS its subscribe now, and `wait`'s exit watcher's first pull
  is what arms it.
- **Unsubscribing is `return()`**, which interrupts the fiber running the
  stream. So the `AbortSignal` a caller still legitimately owns (a Ctrl+C, the
  wait race's settle, `attach`'s detach) is wired to that close HERE, rather
  than threaded into a `{ signal }` call option that no longer exists (D10/#18).
  A parked `next()` then resolves `{done: true}` — an interruption is not a
  failure — so a `for await` ends cleanly and callers keep discriminating "we
  tore this down" from "the feed died" by reading the signal, exactly as before.

`return()` is deliberately not awaited (an upstream-parked producer settles its
close late and would stall the next subscription / a `for await`'s own `break`),
and its rejection is swallowed — closing an already-failed stream can reject,
and that rejection is about the teardown, never about the data already read.

It returns an async iterable ITERATOR so `attach` can hand-advance the opening
frame and then `for await` the rest over the SAME subscription; a second
`[Symbol.asyncIterator]()` would have opened a second attach.

It is a leaf (a bounded algorithm over one call shape), not a receptacle — no
`@kolu/*` extraction is warranted. Note that `@kolu/surface`'s own
`runStreamScoped` would have been the shared answer, but it is only reachable
through the Solid barrel, which a node CLI cannot import; S3 §8.2 already
records the `"./run-stream"` subpath ask, and surface-remote already restated
it twice. **This is the third restatement — please land that subpath in W6.**

## 3. `wait.ts` — the two bounds, restated in Effect terms

Both watchers subscribe through `subscribe(stream, ctx.signal)`, so the
scaffold's "thread ctx.signal into every subscription" contract is met by
construction rather than by remembering an argument.

The UNARY read in `settleOnLostFeed` had no such answer: Effect RPC carries no
cancellation token and the face runs a call with `Effect.runPromise`, so a
half-open wire could park it past the wait's own timeout — and `runWait` AWAITS
its watchers, which is exactly why the old code threaded a signal into it. A
small local `untilAborted(call, signal)` restores the bound: it resolves
`undefined` on abort ("the race settled elsewhere; this answer is no longer
wanted") and the caller returns rather than settling `closed` over an outcome
that already won. What it honestly cannot do — stop the abandoned call — is
stated at the function rather than implied; the call runs to completion (or to
the link's own 5 s ping/pong keepalive failure) unobserved, with its rejection
attached, never orphaned.

`consumeExit` keeps its open-coded `for await … return` and its
`first-frame-guard:allow` marker: the settle must fire at frame-arrival, BEFORE
the iterator's async close, because it races `consumeOutput` in a `Promise.all`
and settle is first-wins. That reason is unchanged by the port.

## 4. `attach.ts` — one branch deleted, on purpose

`isNotFound(err)` on the attach stream is **gone**, and the deletion is
documented at the site. A `StreamSpec` has no error channel to declare on, so
kaval raises `PtyNotFound` from a stream producer as an UNDECLARED failure — a
defect — which crosses a wire opaquely and takes the multiplexed connection with
it (kaval's W3 report §3). The old `code === "NOT_FOUND"` compare has nothing
left to read, and the kaval report names the successor signal: the exit
tombstone, which this loop already falls through to.

Nothing regresses on the paths that matter, and the daemon suite proves it:

- a PTY that never existed is caught by the inventory pre-flight
  (`resolveGone` → `not-found`) — pinned;
- a PTY that EXITS ends its attach stream **cleanly** (no throw at all), so the
  loop falls to the pre-flight and reads the real exit code — pinned
  (`reports the real exit code when the PTY's child exits`, exit 7 over a real
  socket).

What lands in the catch is only the narrow race where the PTY dies between the
pre-flight and the subscribe, and it now reports an honest transport failure
rather than a code the wire no longer carries.

`readExitCode` still goes through the shared `firstFrameOrUndefined` (over
`subscribe(...)`), so `server/src/firstFrameOneShotGuard.test.ts` — which scans
`kaval-tui/src` — stays green. Verified by running it.

## 5. A REAL BUG the port surfaced: `history`'s pager sent `before: undefined`

`cmdHistory`'s full-dump loop spelled its first page as
`getHistory({ id, before, max })` with `before` starting `undefined`.
`before` is `Schema.optionalKey(NonNegativeInt)` — PLAN #17 — so an explicit
`undefined` is a **decode failure**, not the "self-seed from the top of the
screen" request the pager means. zod's `.optional()` tolerated it; this schema
deliberately does not.

`kaval-tui history <id>` (no `--lines`) would have failed on its first
round-trip with `SchemaError: Expected number, got undefined at ["before"]`.
Found by `history.test.ts` running over a real socket, not by review. Both the
shipped pager and the test now SPREAD the key in only once there is a cursor
(`...(before === undefined ? {} : { before })`), with the #17 rule written at
both sites. The `--lines N` arm always omitted the key and was never affected.

## 6. `--host`: rebuilding the face from the dial's dispatch

`dialAgentOnce` now hands back a STRUCTURAL `AgentClient` (= `SurfaceFace`) plus
the transport's tag-keyed `dispatch`. `connectHost` rebuilds the face through
kaval's `ptyHostClientOver(dial.dispatch)` so both transports carry the
identical spec-typed client and every `cmd*()` stays transport-blind — rather
than casting the structural face here, which would have been the second cast §1
exists to prevent.

`dispatch` is optional on the dial because it is a property of the transport,
not of the dial. Its absence is therefore a framework bug, and `connectHost`
disposes the session and `fail()`s with a message that says so — no degraded
path, per the report's own instruction to "treat `undefined` as the loud error
it is rather than degrading".

`kavalHostDialOptions` is generic over the SPEC now and passes
`surface: ptyHostSurface` as a VALUE (the dial builds the wire's `RpcGroup` and
the face out of it). `hostConnect.test.ts` asserts that surface by **identity**
(`toBe`), split out of the policy `toEqual` — "the same surface", not "a
deep-equal blob of schemas", which is the property that actually matters.

## 7. Tests

All ported; none deleted; one assertion strengthened.

| file | change |
|---|---|
| `attach.test.ts` | `servedRouter` → `served`; `servePtyHostOverUnixSocket({served})`; `await conn.dispose()`. The `clientWithSlowWrite` Proxy stack is untouched — the face is a plain object, so proxying `surface.terminal.write` still works. |
| `wait.test.ts` | same three mechanical edits. Every acceptance case (idle window, idle-after-bursts, blocks-to-timeout, regex match, `gone` on kill, `interrupted` on abort) runs unchanged over the real socket. |
| `history.test.ts` | same, plus the attach-snapshot read moved from a hand-rolled `[Symbol.asyncIterator]()` + `it.next()` (which also leaked the subscription) to `firstFrameOrThrow(subscribe(...))`, and it now NARROWS on `kind === "snapshot"` instead of casting the frame to `{data: string}` — an honest read of the union rather than a cast past it. Plus §5's `before` fix. |
| `hostConnect.test.ts` | the surface asserted by identity (§6). |
| `create.test.ts`, `send.test.ts`, `sendExec.test.ts`, `render.test.ts`, `escape.test.ts`, `historyPage.test.ts` | untouched — pure logic, green before and after. |

`render.ts`'s `formatList`/`formatListJson` take `readonly PtyHostListEntry[]`
now: a decoded `Schema.Array` hands the caller a readonly array.

## 8. Gates

```
pnpm --filter kaval-tui typecheck                → 0 errors
pnpm --filter kaval-tui test:unit                → 10 files, 110 passed, 22 skipped
KOLU_DAEMON_TESTS=1 … test:unit                  → 10 files, 132 passed, 0 skipped
biome lint --error-on-warnings packages/kaval-tui → clean, 27 files
biome format packages/kaval-tui                  → clean (scoped, not repo-wide —
    sibling agents share this worktree; same choice every W2/W3/W4 report made)
grep for zod / @orpc across src/                 → no hits
```

### The cross-package verdict this package owed

```
KOLU_DAEMON_TESTS=1 pnpm --filter kaval exec vitest run src/socketDaemon.test.ts
  → 1 file, 27 passed, 0 failed
```

**GREEN.** The 5 tests kaval's W3 report left red — all of them spawning the
kaval-tui binary and dying on `SyntaxError: … does not provide an export named
'isDeadTransportError'` — pass with no edit to `packages/kaval`, exactly as that
report predicted.

`packages/server/src/firstFrameOneShotGuard.test.ts` (which scans
`kaval-tui/src`) also run and green: 3 passed.

## 9. Public API notes

`kaval-tui` is a private binary, not a library, so there is nothing to add to
the drishti/odu break list. Two internal shapes a future reader should know:

1. `Connection.dispose` is `() => Promise<void>` and every call site awaits it —
   a wire link's dispose releases the scope holding its protocol fibers, and
   dropping it unawaited leaks them into the exit path.
2. `PtyTuiClient` is an alias, not a derivation. If kaval's face type moves,
   this package moves with it by compile error rather than by re-inference.

## 10. Nothing here invalidates a PLAN assumption

- **D2/#13** lands where the kaval report said it would: procedure and stream
  inputs are the Encoded side, and §5 is the one place that actually bit — an
  `optionalKey` field a caller was passing as explicit `undefined`.
- **D4** is realised: the one `.code` compare left in this package became
  `isDeadTransportError`, and the one branch that read a code the wire no longer
  carries was DELETED with its successor named (§4), not faked.
- **D10/#18** holds: no `AbortSignal` crosses a surface call. The three signals
  that remain are all CONSUMER-edge (`runWait`'s race, `attach`'s detach
  controller, `main`'s shutdown-signal controller) and are translated into fiber
  interrupts at exactly one seam, `src/stream.ts`.
- **#17 is LAW** and §5 is the proof it has teeth outside the schema packages.
- **PLAN rule 8**: no `as any` added. `history.test.ts` DELETED one cast
  (`first.value as { data: string }`) in favour of a real narrow.
- No `package.json` `dependencies` block changed ⇒ standing rule 5 does not fire.
