# W2 fanout — `@kolu/surface-daemon` on the Effect surface core

Scope delivered: `controlCore.ts` (+ test), `daemonMain.ts` (+ test),
`tenure.fixture.testlib.ts`, `frontDaemonOverStdio.ts` (comment only), the
package README, and the two surface-daemon docs pages the D6 doctrine lives on.
Nothing else in the tree was touched.

The blast radius was small by construction: this package's job is *lifecycle*
(gate → serve → teardown, home, pid gate, tenure, upgrade-window fixtures), and
only two files ever knew what a surface was.

---

## 1. `daemonMain` — `router` dies, `{ group, handlers }` arrives

```ts
interface DaemonSpec {
  home: DaemonHomePaths;
  group: RpcGroup.RpcGroup<Rpc.Any>;   // was: router: Router<any, any>
  handlers: SurfaceHandlers;           //  ↑ one field became two
  lifetime: DaemonLifetime;
  log: Logger;
  // … anchor / anchorPollMs / signal / onReady / gate / processIdentity /
  //   readProcessIdentity — all unchanged
}
```

Two flat fields rather than one `surface: { group, handlers }` wrapper,
deliberately: `DaemonSpec` forwards these values verbatim to
`serveOverUnixSocket({ socketPath, group, handlers })`, and spelling them the
same way on both sides means the spine invents no vocabulary a caller has to
learn. The `@orpc/server` `Router` type import is gone, and with it the
`noExplicitAny` biome-ignore that existed only to carry `Router<any, any>` —
`Rpc.Any` is the honest erasure (review #16: a spec-walk-assembled group carries
no type information a caller could trust, and route-set identity is asserted at
`implementSurface` time, not here).

`serveOverUnixSocket`'s `log` option is gone (S4 deleted `UnixSocketLogger`), so
`daemonMain` no longer forwards its logger to the transport. Its own boot /
shutdown / refusal narration is untouched — a comment at the call site says
which chatter disappeared and why, so nobody re-adds a knob for it.

**Everything else about the skeleton is byte-for-byte the shipped behaviour**:
the gate short-circuit, `dir-not-private` → `serve-failed`, arm-before-announce,
the `alreadyOver` no-announce path, `disarm` on a throwing `onReady`, the
anchor self-reap's two-consecutive-ENOENT rule, `daemonLifetimeFromEnv`'s
fail-fast parsing. All 104 tests still pin them, including the seven real-child
`tenure.test.ts` pins that fork an actual daemon bin and now serve over the
Effect unix-socket path end to end.

## 2. `controlCore.ts` — zod → Schema, and the D6 epoch break

### 2.1 Schema

```ts
export const ControlCoreHelloSchema = Schema.Struct({
  stateRoot: Schema.String,
  surfaceVersion: Schema.String,
  controlCoreVersion: Schema.String,
  startedAt: Schema.Number,
  commit: Schema.optionalKey(Schema.String),
  buildId: Schema.optionalKey(Schema.String),
});
export type ControlCoreHello = typeof ControlCoreHelloSchema.Type;
```

`optionalKey`, never `optional` — the #17 mapping law, and it matters here
concretely: `Schema.optional` round-trips an explicit `undefined` through
`null`, which zod's `.optional()` never did, and the identity pair's whole
contract is *absent / both-empty / both-non-empty*. A `null` would be a fourth
state the shared reader has no arm for.

`controlCoreFragment`'s two handlers are now Effect-returning
(`Effect.succeed` / `Effect.promise`). `Effect.promise` and **not**
`Effect.tryPromise`: the procedure declares no error schema, so a rejecting
`onDrain` is an UNDECLARED failure and must stay a defect (D4) rather than
become something a supervisor could narrow on and "handle". A daemon whose drain
hook throws is broken, not busy. Pinned by a new test.

### 2.2 The doctrine, re-scoped (PLAN D6 / finding #2)

The header no longer says "this channel never versions". It says **"this channel
never versions — within a protocol epoch"**, and then states the epoch break
that made the qualifier necessary: this fragment used to ride oRPC's
base64+newline peer codec and now rides Effect RPC ndjson. That is a declared
flag day, not a negotiation — negotiation happens *inside* the protocol being
replaced, which is the whole content of #2. Across epochs there is no handshake
(the supervisor's D6/#3 `unspeakable-protocol` observation, W4); within this
epoch the frozen contract holds again, unchanged.

The same doctrine landed in the two docs D6 names, in this commit:
`website/src/content/surface/ref-surface-daemon.mdx` (a new paragraph under
*The frozen control core*) and `surface-daemon-invariants.mdx` (a new
**Frozen within an epoch** row).

### 2.3 `CONTROL_CORE_VERSION` did NOT move — deviation, with reasons

Finding #2's suggested fix included "bump `CONTROL_CORE_VERSION` despite the
comment". **PLAN D6, which is the locked decision that integrates #2, does not
say that** — it says re-scope the doctrine and document the epoch, and its final
bullet enumerates the constants that still bump (`PTY_HOST_CONTRACT_VERSION`,
`PADI_SURFACE_VERSION`) with `CONTROL_CORE_VERSION` pointedly absent. I followed
D6, for two substantive reasons:

1. **A bump would be inert across the only boundary it could describe.** The
   value is read *off* this wire (`readControlCoreHello` compares it). A peer
   from the previous epoch cannot present it at all — its first frame is
   undecodable. That is #2's own diagnosis of why the version lever is the wrong
   tool here; bumping it would be theatre, and worse, it would tell a
   same-epoch reader that the payload changed.
2. **The payload did not change.** Same six fields, same order, same
   absent-means-absent optionality.

Point 2 is now **evidence, not assertion**: `controlCore.test.ts` gained three
byte-level fixtures asserting the exact encoded JSON string for the baked pair,
the absent pair (proving `optionalKey` omits rather than nulls), and the
off-nix empty pair's round trip. If a field is ever added, removed, or renamed
those fixtures fail first, and a fourth test names the bump as that commit's
job.

If the reconcile pass wants the loud marker anyway, the change is one line plus
the five hardcoded `"1.0"` expectations in packages I must not touch (padi
`surface.test.ts` / `dial.test.ts`, kaval `daemonSurface.test.ts`, supervisor
`probeDaemonIdentity.test.ts`, server `padiBinding`/`remotePadiBinding` tests) —
all of which W3/W4/W5 are rewriting regardless.

## 3. `frontDaemonOverStdio` — still a contract-blind byte splice (#10)

No code change. The framing comment was the lie: it claimed the two legs share
"the same `@kolu/surface` peer framing (base64+newline)". Base64 is dead; the
comment now says **ndjson**, and — more importantly — it stops asserting the
identity and cites the proof: `packages/surface/src/links/byteSplice.test.ts`
captures raw bytes from both legs, carries a unary *and* a streaming member
through a real splice in both directions, shows the two legs frame the same call
character for character, and closes the half of #10 the newline argument never
answered (base64 existed for BINARY safety) by asserting every captured byte is
plain JSON text delimited by `\n`.

The proxy therefore keeps its defining property — `node:net` +
`node:child_process` only, no surface import, no new dependency edge into a
consumer's guarded runtime closure (kaval's `buildId.closure.test`).

## 4. The upgrade-window testlibs — verified unaffected

The brief asked for a careful read. All four are **transport-neutral by
construction**, and none of them dials a surface:

| testlib | what it actually touches | verdict |
|---|---|---|
| `upgradeWindowYesterdayDaemon.testlib.ts` | plants a live child process, gate bytes, and a bare `net.createServer` that accepts and **never speaks any protocol** (accepted peers are explicitly unread fixture traffic); state planting is a required injected hook | framing-blind — keeps passing |
| `upgradeWindowArtifacts.testlib.ts` | pure fs walk + registry basename/pattern matching + the version-disposition proof machinery | no wire at all |
| `upgradeWindowAssertions.testlib.ts` | `pinPreviousShapeRecovery` (caller supplies `parse`/`recover`) and `assertRecipeWired` (justfile text) | no wire at all |
| `upgradeWindowPreviousRelease.testlib.ts` | tag/store-inequality guards, a process reaper, and `waitForSocket(path, probe)` / `runPreviousReleaseWindow({newReadsOld, oldReadsNew})` — **every probe and both arms are injected** | no wire of its own |

So: **both ends built from current source keep passing, and they do here** (the
package is 104/104 green). The previous-release *binary* problem is entirely in
the CONSUMER of the last row — padi's `previousRelease.e2e.test.ts`, whose
`newReadsOld` arm dials a v-previous daemon with a current `@kolu/surface`
link. That is D6/#1/#19's harness rewrite and belongs to **W4**. I did not
touch it, did not weaken any guard, and did not change a single testlib
signature, so W4 inherits the same injection seams it needs (a transport-neutral
`probe` for `waitForSocket`, a `newReadsOld` re-stated as permanently the
recycle arm).

## 5. Review finding #11 — checked, no registration needed

The Layer rewrite could have added a daemon-lifecycle disk artifact. It did not:
`serveOverUnixSocket`'s only filesystem writes are the socket's parent dir
(`mkdirSync` 0700) and the socket inode itself, both pre-existing and both
already registered by `daemonHome`'s `artifacts` pair. Effect's RPC/ndjson stack
writes nothing to disk, and `daemonMain` adds no marker or lock. Grepped
`unix-socket.ts` / `peer-server.ts` / `links/*.ts` for every write primitive to
confirm. **No `sharedArtifacts.testlib.ts` entry is required by this commit.**

## 6. API-break list additions (drishti / odu follow-up)

1. **`DaemonSpec.router: Router<any, any>` → `DaemonSpec.group:
   RpcGroup<Rpc.Any>` + `DaemonSpec.handlers: SurfaceHandlers`.** Every
   `daemonMain` call site changes: `router: runtime.router` becomes
   `group: runtime.group, handlers: runtime.handlers`. drishti's daemon rides
   `daemonMain` directly — this is its one required edit in this package.
2. **`ControlCoreHelloSchema` is an Effect `Schema.Struct`, not a `z.ZodObject`.**
   `ControlCoreHello` is now `typeof …Schema.Type` (same six fields, same
   optionality). Any consumer calling `.parse` / `.safeParse` on it moves to
   `Schema.decodeUnknownSync` / `Schema.decodeUnknownResult`. The **encoded
   bytes are unchanged** — byte-pinned here — so nothing on disk or on the wire
   has to migrate.
3. **`controlCoreFragment`'s handlers return `Effect`.** A consumer that
   re-implements the fragment by hand (rather than calling the factory) writes
   `Effect.succeed(...)` / `Effect.promise(...)`; a rejecting `onDrain` is now a
   defect, not a member error.
4. **No `package.json` change.** `zod` and `@orpc/server` remain declared
   dependencies with zero imports left in `src/` — W6's purge, per its brief.
   PLAN standing rule 5 does **not** fire for this commit.
5. Not broken: every other export. `daemonHome`, the whole pid-gate surface,
   `daemonProcessMain`, `frontDaemonOverStdio` / `reExecAsDetachedDaemon`,
   `readBakedIdentity`, `convergenceIdentity`, `SharedArtifact`, and all four
   `./upgrade-window.testlib` modules keep their exact signatures. `index.ts` is
   untouched.

## 7. Deviations, in one place

1. **`CONTROL_CORE_VERSION` stays `"1.0"`** — §2.3, following PLAN D6 over
   finding #2's suggested wording, with byte fixtures as the licence.
2. **Two `website/` MDX files edited** even though PLAN W6 owns website prose.
   D6 requires the doctrine to move "in the SAME commit that changes the wire",
   and these two pages are surface-daemon's own. The edits are surgical (one new
   paragraph, one new invariant row, three stale `router` mentions); the rest of
   the surface-daemon reference is left for W6's sweep.
3. **`just fmt` was NOT run repo-wide.** Concurrent agents share this worktree
   and `just fmt` is `biome format --write .`, which would rewrite their
   in-flight files. Ran `biome format --write` scoped to
   `packages/surface-daemon` instead (1 file fixed), then verified
   `biome format` reports clean over the package **and** both MDX paths. Same
   choice S4 made, same reason. `nixpkgs-fmt` is moot — no `.nix` file changed.

## 8. Gates

```
pnpm --filter @kolu/surface-daemon typecheck        → 0 errors
KOLU_DAEMON_TESTS=1 pnpm --filter … test:unit       → 11 files, 104 tests, ALL GREEN
   (incl. the 7 real-child tenure pins, which fork an actual daemon bin and
    serve over the new Effect unix-socket path end to end)
biome lint --error-on-warnings packages/surface-daemon → clean, 35 files
biome format packages/surface-daemon + the 2 MDX paths → clean
```

Zero `zod` / `@orpc/*` **imports** remain in `packages/surface-daemon/src/`.
The only surviving mentions are prose in four comments that deliberately record
what the epoch break replaced.

## 9. Nothing here invalidates a PLAN assumption

- **D6 holds**, with its version-constant bullet followed literally (§2.3) and
  its "same commit" documentation clause discharged in code and in both docs.
- **#10 is closed for this package**: the splice keeps its contract-blindness,
  and the comment now points at evidence instead of making a claim.
- **#11 is a no-op here**, verified rather than assumed (§5).
- **#9 is untouched by this package** — the hello deadline and `awaitHelloGone`
  live in `@kolu/surface-daemon-supervisor`.
- **#1 / #19's harness rewrite is intact and unblocked**: the testlibs kept
  every injection seam W4 needs (§4).
