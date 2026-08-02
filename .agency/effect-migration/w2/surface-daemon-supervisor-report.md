# W2 fanout — `@kolu/surface-daemon-supervisor` on the Effect surface core

Scope delivered: `probeDaemonIdentity.ts` (+ test), the NEW
`convergence/unspeakable.ts` (+ the NEW `unspeakableProtocol.test.ts`),
`convergence/{anomaly,converge,giveUp,index}.ts`, `endpoint.ts`,
`deps.closure.test.ts`, and the package's Reference page. Nothing outside
`packages/surface-daemon-supervisor/` and
`website/src/content/surface/ref-surface-supervisor.mdx` was touched — including
`packages/surface-daemon`, which turned out not to need the coordinated edit the
brief permitted.

The blast radius was small by construction. Recon was right that this package has
**zero zod and zero `@orpc` imports**: only ONE file ever knew what a wire was
(`probeDaemonIdentity.ts`, the frozen control-core dial). Everything else here is
gate files, pids, sockets and policy. So the port is one file — and the
centerpiece, D6/#3, is the real work.

---

## 1. The dial — `probeDaemonIdentity.ts`

```ts
composeSurfaceContracts({ control: controlCoreSurface })  // → { group, siblings }
dialSocket(socketPath)                                    // this package's own dial
  → tap the first frame (RpcSerialization.ndjson)
  → duplexWireLink({ group, duplex: socket, describe })   // { dispatch, dispose }
  → buildSurfaceFace(composed.siblings.control, dispatch)
  → { surface: { control: face.surface } }                // client.surface.control.core.hello()
```

`ControlCoreProbeClient` is **unchanged** — still
`client.surface.control.core.{hello,drain}` returning Promises. That matters: the
connector arms (`remotePadiBinding`, drishti) hand `probeDaemonIdentityFrom`
their own full app client, where `control` is a composed SIBLING, so the shape has
to keep the sibling level. The sibling face's own members are `{ core: {…} }`, so
the dial re-nests it under `control` at exactly one place.

`readControlCoreHello`, `probeDaemonIdentityFrom`, `isNoListenerError`,
`withHelloDeadline`'s 30 s constant and every assertion in them are byte-identical
to what shipped.

### 1.1 Deviation: `duplexWireLink` + `dialSocket`, not `unixSocketLink`

The brief says "dials over the new `unixSocketLink`". It does not, and the reason
is the centerpiece: **the framing tap needs the connected socket, and
`unixSocketLink` dials it internally.**

Everything observable is preserved, because `unixSocketLink` *is* `dialSocket` +
`duplexWireLink`:

- `dialSocket` (this package's own one-place connect/error-race owner) rejects
  with the raw socket error, so `ECONNREFUSED`/`ENOENT` ⇒ `null` — the "nothing is
  serving here" verdict every probe in the tree reads — exactly as
  `unixSocketLink`'s deliberately EAGER dial does (S4 §2);
- `duplexWireLink` is the shared body BOTH `unixSocketLink` and `stdioLink` are
  built from, so the bytes are the same bytes either leg writes (S4's byte-splice
  proof covers this wire unchanged).

**Ask of the reconcile pass**: give `unixSocketLink` a first-frame/tap seam (or
export `duplexWireLink` deliberately rather than incidentally), and this file goes
back to the one-liner. I did not edit `@kolu/surface` to add it.

### 1.2 `dispose` stays synchronous

`ConvergenceProbeBase.dispose(): void` is unchanged — connector arms hand us their
own sync disposer, and making it async would ripple through `converge`,
`characterizeHeld` and every consumer for no gain. The link's async `dispose()` is
fired and not awaited, with the reason in code: a scope-close failure is a
framework defect and must surface as an unhandled rejection, not be swallowed.

---

## 2. THE CENTERPIECE — `unspeakable-protocol` (PLAN D6 / review #3, #9)

### 2.1 What raises it, and what does not

`convergence/unspeakable.ts` is a zero-import leaf with **two** types, because the
fact and the verdict are not the same thing:

| type | meaning | who mints it |
| --- | --- | --- |
| `UnspeakableProtocolError` | TRANSPORT fact: the peer's FIRST frame failed to decode. Fields: `socketPath`, bounded JSON-quoted `frame` | the dial path |
| `UnspeakablePeerError` (extends it) | CORROBORATED verdict: same fact + `gatePath` + verified `pid` | `endpoint.ts`, and only it |

Only the second becomes a convergence observation. That split IS the safety story:

- **`probe-failed` is never widened.** `observeProbe` narrows on
  `isUnspeakablePeerError` and nothing else; an UNcorroborated decode failure —
  including every stranger babbling on our socket — folds to `failed` exactly as
  before (`bindResult.ts`'s "never catch-to-null" note stays honored).
- **`SocketSquatterForeignError` is untouched.** The gate-less-squatter recovery
  is not on this path at all: no gate of ours ⇒ no corroboration ⇒ probe-failed ⇒
  the recovery keeps its own refusal. Pinned by test 1 of the new suite.

### 2.2 The decode is Effect's own parser, one layer earlier

The tap runs `RpcSerialization.ndjson.makeUnsafe().decode(chunk)` — the *very
implementation* `RpcClient.makeProtocolSocket` runs — so "undecodable here" means
exactly "undecodable there". This is not a second framing authority; it is the
same one asked earlier. **A frame that decodes into a JSON value that is not an
RPC message at all is SPEAKABLE**: the classification is about FRAMING, never
semantics, which is what keeps it as narrow as D6/#3 requires. Pinned.

Two mechanical notes, both stated in code:

- the tap attaches BEFORE the link's own reader, because a socket with no reader
  is paused and whichever `data` listener attaches first drains the buffer. A
  legitimate peer never speaks before we do (an RPC server answers, it does not
  greet), so the tap can only ever front-run a peer that is already misbehaving;
- the listener is never removed while the link lives — removing the only `data`
  listener leaves a socket flowing with nobody reading, which drops bytes.

The alternative I rejected: classify by sniffing the `SurfaceStdioTransportClosed`
message for `RpcClientDefect: Error decoding message`. That is prose-parsing, and
this package's whole style is evidence-as-a-field.

### 2.3 Corroboration lives where the gate lives (`endpoint.ts`)

`endpoint.probe` is no longer `spec.probe(primary.socketPath)` — it is
`probeCorroborated`, which catches ONLY `UnspeakableProtocolError` and escalates
it to `UnspeakablePeerError` when `liveServingHolderProbe(primaryRv)` returns a
holder. Reusing that function is deliberate: it is this package's ONE definition
of "a gate of ours naming a pid we verified" (two-field ±2 s identity match, or
the legacy one-field liveness + a serving socket), and it is the same verdict the
subsequent SIGTERM would act on. `liveServingHolderProbe`, not
`liveServingHolder`: a probe is an observation, and emitting `dead` from it would
report a transition the fold has not decided.

An unreadable gate or an indeterminate socket probe is **not** a NO — it is "we
could not ask" — so the ORIGINAL error is rethrown (⇒ probe-failed) and the gate
error is LOGGED rather than lost.

`characterizeHeld` deliberately does NOT escalate: it runs only after the soul's
`connect` already handshaked at that rendezvous, so a suddenly-undecodable peer
there is an anomaly about a connection we already hold — `failed` is the honest,
conservative reading. Stated in code.

### 2.4 Dispositions — the contract-skew policy decides

An undecodable wire is the LIMIT CASE of a contract skew: the one whose version
cannot be read. So `enactUnspeakable` folds it through `policy.onContractSkew`,
and `decide()` is untouched (it folds an identity; an unspeakable peer never
yielded one).

| policy | disposition |
| --- | --- |
| `recycle` (kaval) | SIGTERM the verified gate holder + spawn fresh ⇒ outcome `recycled` |
| `refuse` · `drain-newer-else-refuse` (padi) | `refused`, with the `unspeakable-protocol` cause ⇒ survivor left standing + degraded |

**Why the recycle arm needed a new bind.** `ctx.bind` could not serve it. The
ordinary adopt-or-recycle bind only recycles a survivor the soul's `connect`
PROVED to be a skew — and an unspeakable peer proves nothing to a `connect` that
cannot speak to it either: it fails NON-skew, which `adoptAt` reads as
"unreachable" and leaves standing. That is precisely the wedge D6/#3 exists to
break, so the fold gained ONE new seam, `FoldCtx.recycleHolder`, wired in
`converge()` to the endpoint's existing `ensure()` (always-recycle: kill the
verified holder, spawn, connect, hold). No new kill mechanism was written; the
existing one is named. A failing `ensure()` throws out of `converge` exactly as a
throwing `bind` already does — a recycle that could not happen must not be
reported as a bind that merely refused.

**The refuse message is operator-facing and says the mechanism**, because it is
the only thing that tells a human why an upgrade did not converge:

> …answered our first frame with `"…"` — it speaks a protocol epoch this
> supervisor cannot decode. **Its drain verb is therefore unreachable, so
> drain-newer-else-refuse degenerates to REFUSE**: the survivor is left standing
> + degraded and is never killed. Stop that daemon out of band … and boot again
> to converge.

The evidence rides as DATA next to it (`cause: { kind: "unspeakable-protocol",
socketPath, gatePath, pid }`) — a UI never parses the sentence.

### 2.5 Review #9 — classification at the decode, not at the deadline

The frozen hello's deadline is 30 s. `raceUnspeakable(work, conn)` lets the tap's
signal win, so an unspeakable peer costs a caller nothing:

- **the probe** rejects at the decode. Pinned by a test that races the probe
  against a 2 s bound and requires the classification to win (the whole
  `probeDaemonIdentity` suite runs in ~120 ms);
- **`awaitHelloGone`** — this is the "explicit bound for the unspeakable case".
  The loop still polls for actual disappearance (an unspeakable peer is NOT
  absence; only a dial that finds no listener is), but each ATTEMPT is now bounded
  by the decode instead of burning the whole 30 s deadline — which, inside a drain
  ceiling, is the difference between an exit oracle and a stall.
  Note `drainAndAwaitExit` documents that `awaitExit` MUST NOT reject (it swallows
  a rejection and waits out the ceiling), so throwing there would have been
  theatre; bounding the ATTEMPT is the honest reading of #9.

---

## 3. Tests

`probeDaemonIdentity.test.ts` ported (new `serveOverUnixSocket({group, handlers})`,
`Effect`-returning handlers) and **+3**:

1. an undecodable first frame ⇒ `UnspeakableProtocolError`, with `socketPath` and
   the exact JSON-quoted `frame` (a peer's newlines/control bytes cannot reshape
   an operator log line);
2. it classifies at the decode, not at the 30 s deadline (#9);
3. a WELL-FRAMED line that is not an RPC message stays an ordinary probe failure —
   framing, never semantics.

`unspeakableProtocol.test.ts` (NEW, 4 tests), end to end through the REAL
`createEndpoint` and the REAL fold:

1. **corroboration is required** — accepting socket, no gate of ours ⇒
   `unconverged`/`probe-failed`, `spawn` and `connect` both assert-if-called;
2. **refuse (padi)** — our gate + verified pid ⇒ `refused` with the exact typed
   cause, the three load-bearing phrases in `detail`, nothing held, nothing
   spawned;
3. **recycle (kaval)** — `describeDaemon`-gated, with a REAL forked child holding
   the gate over a real listening socket: the child is SIGTERM'd
   (mutate-to-prove: `process.kill(pid, 0)` throws afterwards), a fresh daemon is
   spawned exactly once, last status `connected`;
4. the corroborated **brand** refuses a carrier missing either attestation — a
   forged "peer" error must not buy a SIGTERM.

All **14 existing test files keep their laws**; none was renamed, weakened or
moved. The new file is the 15th (14 vitest-collected files + the `.test-d.ts`).

---

## 4. API-break list additions (drishti / odu follow-up)

1. **`UnconvergedCause` gains an arm**: `unspeakable-protocol` (`socketPath`,
   `gatePath`, `pid`). Any exhaustive switch over that union must grow a case.
   **⚠ In-repo obligation, W3**: `packages/common/src/surface.ts`'s
   `PadiConvergenceSchema` mirrors this union as a STRICT discriminated union
   (`z.discriminatedUnion("kind", […five arms])`). A supervisor emitting the new
   cause would fail that schema at the app boundary — W3's zod→Schema rewrite of
   `common` **must add the sixth arm**. drishti, if it mirrors the union, has the
   same obligation. I did not touch `packages/common` (not my package).
2. **New exports** (root, via `convergence/index.ts`): `UnspeakableProtocolError`,
   `UnspeakablePeerError`, `isUnspeakableProtocolError`, `isUnspeakablePeerError`.
3. **`probeDaemonIdentity(...)(socketPath)` has a new rejection shape**: an
   undecodable first frame now rejects with `UnspeakableProtocolError` instead of
   an opaque transport error. `null` is still returned for, and only for,
   `ECONNREFUSED`/`ENOENT`.
4. **`Endpoint.probe` now corroborates.** A consumer that called
   `spec.probe(socketPath)` itself gets the raw transport fact; the corroborated
   verdict exists only on the endpoint's own `probe()`. Behaviour-compatible for
   every existing caller.
5. **Not broken**: `ControlCoreProbeClient`, `probeDaemonIdentityFrom`,
   `readControlCoreHello`, `isNoListenerError`, `converge`, `convergeAdmit`,
   `decide`, every budget/instance-key/anomaly export, the whole endpoint surface
   (`createEndpoint`, `EndpointSpec`, the three typed errors and their
   predicates), `dialSocket`, `driver`, `restart`, `waitForPidGone`, and both
   testlibs — all keep their exact signatures.
6. **`package.json` untouched.** `effect` and `@effect/platform-node` were already
   declared (W1.5's #21 dep-hole fix); the new `effect/unstable/rpc` import is the
   first actual use. PLAN standing rule 5 does **not** fire.

---

## 5. Deviations, in one place

1. **`duplexWireLink` + `dialSocket` instead of `unixSocketLink`** — §1.1, with
   the seam request for the reconcile pass.
2. **`deps.closure.test.ts`'s `ALLOWED_EXTERNAL` gained `effect`** — the guard's
   whole point is that a new external edge forces a conscious decision, so here it
   is: the edge exists to ask Effect's OWN ndjson parser about framing rather than
   grow a second framing authority in this package. `effect` is already a declared
   dependency, and it is the same kind of leaf the `@kolu/surface` edge is. Still
   emphatically no `kolu-*` app package.
3. **`giveUp.ts`'s `unconvergedDetail` gained a case** for the new cause. It is
   not reachable from a give-up today (a budget governs DRAINS; an unspeakable
   peer is refused or recycled before any drain is proposed), but that renderer is
   TOTAL over the union and a cause that can be constructed must be renderable.
   Said so in code.
4. **The Reference page was updated in this commit**
   (`ref-surface-supervisor.mdx`), per `.claude/rules/surface-reference.md`: the
   two new export rows, the widened `UnconvergedCause` row, the `probeDaemonIdentity`
   row, and a new "The third observation" section with the disposition table.
   One adjacent correction: the paragraph claiming a consumer catches "that
   structured `NOT_FOUND` frame" named an oRPC frame that no longer exists — it now
   says the failure shape moved with the epoch and a consumer's narrowing
   re-derives on the Effect RPC failure (a real W4/W5 item for kaval's
   older-build projection).
5. **`just fmt` was NOT run repo-wide.** Concurrent agents share this worktree and
   `just fmt` is `biome format --write .`, which would rewrite their in-flight
   files (surface and surface-remote were both dirty during this work). Ran
   `biome format --write` scoped to `packages/surface-daemon-supervisor` instead,
   then verified clean. Same choice S3/S4/surface-daemon made, same reason. No
   `.nix` file changed, so `nixpkgs-fmt` is moot.

---

## 6. Gates

```
pnpm --filter @kolu/surface-daemon-supervisor typecheck   → 0 errors
KOLU_DAEMON_TESTS=1 vitest run                            → 14 files, 141 tests, ALL GREEN
  (default `test:unit`, gate off: 9 files / 90 tests pass, 5 files / 51 tests skipped)
biome lint --error-on-warnings packages/surface-daemon-supervisor → clean, 42 files
biome format packages/surface-daemon-supervisor                   → clean
```

Zero `zod` and zero `@orpc/*` imports remain — there were none to begin with
(recon `surface.md` row: `none | 0 | 0`), and none were introduced.

---

## 7. Nothing here invalidates a PLAN assumption

- **D6 is now complete on the supervisor side**: #2 (the epoch doctrine) landed
  with surface-daemon; #3's third observation and both dispositions land here;
  #9's "classify at the decode" is realised and pinned, with `awaitHelloGone`'s
  per-attempt bound as its concrete form.
- **`decide()` stays pure and untouched** — the new observation never produces an
  identity, so there was nothing for the pure fold to decide.
- **#1/#19's harness rewrite (W4) is unblocked and now better armed**: a
  previous-release daemon that answers with undecodable bytes is exactly the
  observation this commit adds, and `previousRelease.e2e.test.ts`'s "compatible
  contract → adopt" arm can be re-stated as the recycle arm using it.
- **The one downstream obligation** is §4.1's `packages/common` schema arm. It is
  a W3 edit, not a latent bug here: nothing in this package encodes the anomaly.
