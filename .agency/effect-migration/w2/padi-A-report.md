# W3 — `padi` SLICE A: schemas · contract v5.0 · tagged errors · publisher

Scope delivered: `vocab.ts`, `surface.ts`, `chromeVocab.ts`, `newTerminalPolicy.ts`,
`session/pairedDaemon.ts`, `transcript/transcriptSchema.ts`, `publisher.ts`,
`dial.ts`, a NEW `errors.ts`, every `ORPCError` throw/catch site
(`terminals.ts`, `terminal-registry.ts`, `preview.ts`, `transcript/transcript.ts`,
`terminalWorkspace/endpoint.ts`, `terminalEndpoint/reattachingDeltas.ts`,
`ptyHost/missingFrozenFragment.ts`) and the tests of all of the above, plus a NEW
`vocabByteCompat.test.ts`. `package.json` untouched, so PLAN standing rule 5 does
not fire.

Slice B (`daemonBoot`, services, `servePadi`, `terminalEndpoint`, `ptyHost`,
`watch`, `upgradeWindow`) is untouched except for ONE mechanical import fix, named
in §7.

---

## 1. `PADI_SURFACE_VERSION`: "4.7" → **"5.0"** (PLAN D6)

The bump is the **protocol-epoch flag day**, and the note in `surface.ts` says
exactly that. No payload shape moved — every member encodes byte-for-byte as it
did under zod, which `surface.test.ts` and `vocabByteCompat.test.ts` now assert as
**literal JSON strings** rather than assume. What moved beneath them is the
framing (oRPC peer protocol → Effect RPC ndjson) and the declared error channel
(a code map → tagged classes).

Why bump when the lever is inert across the only boundary that changed: the
constant is the **in-epoch skew mechanism** (D6's final bullet) and must keep
working from the flag day forward. Leaving it at "4.7" would let two mutually
undecodable epochs report the SAME string, so a `4.7`-reporting survivor would
compare EQUAL to this build and be adopted as wire-compatible — the surface's own
version lever silently disarmed across the one break it most needed to name. That
hazard is now a test (`surface.test.ts`, the version block), not a comment.

Cross-epoch peers stay the supervisor's `unspeakable-protocol` domain (D6/#3);
this module never claims to classify them.

## 2. Shapes — what a consumer now holds

### 2.1 `padiDaemonContract` — one flat group, two sibling `Surface`s

```ts
padiDaemonContract = composeSurfaceContracts({ padi, control })  // { group, siblings }

export const padiDaemonGroup: RpcGroup<Rpc.Any>              // NEW — all 68 tags
export const padiSurfaceSibling: Surface<typeof padiSurface.spec>    // NEW, "surface/padi/"
export const padiControlSibling: Surface<typeof padiControlSurface.spec> // NEW, "surface/control/"
export const PADI_DAEMON_TAG_COUNT: number                   // NEW — the #16 assert
```

`padiDaemonContract.surface.{padi,control}` is **gone** (there is no nested
contract object any more); `.siblings.{padi,control}` replaces it.

Composition is the framework's SIBLING algebra (S1/D1) — each surface re-walked
under its own prefix — never `RpcGroup.merge`. Both surfaces carry the same three
reserved `system/*` tags, and `merge` is a last-writer-wins `Map.set`, so a bare
merge would have silently left ONE sibling's liveness probe answering for the
other's. The prefix makes that unrepresentable; `PADI_DAEMON_TAG_COUNT` is
asserted **at import** (a boot crash, never a production 404) and
`surface.test.ts` spells the sibling-disjointness and twelve literal tags.

### 2.2 The dial client — one dispatch, two typed faces

```ts
interface PadiDaemonClient {
  readonly dispatch: SurfaceDispatch;
  readonly padi: PadiSurfaceClient;      // client.padi.surface.<member>.<verb>
  readonly control: PadiControlClient;   // client.control.surface.core.<verb>
}
function padiClientOver(dispatch: SurfaceDispatch): PadiDaemonClient   // NEW
function scopePadiSurface(client: PadiDaemonClient): PadiSurfaceClient // same name, now a field read
```

`ContractRouterClient<PadiDaemonContract, ClientRetryPluginContext>` is gone with
the contract. Under oRPC the two siblings were NESTED namespaces on one client
(`client.surface.control.core.hello`). The Effect wire namespace is FLAT, so a
sibling is a TAG PREFIX, not a nesting: each face is built from its own `Surface`
value over the SAME dispatch (S3's `buildSurfaceFace`). **Every call site changes
shape**:

| before | now |
|---|---|
| `client.surface.control.core.hello()` | `client.control.surface.core.hello()` |
| `client.surface.padi.lifecycle.create(x)` | `client.padi.surface.lifecycle.create(x)` |
| `scopeSibling(client, "padi")` | `scopePadiSurface(client)` (or `client.padi`) |

Keeping the dispatch on the value is what lets a consumer build any further face
without re-dialing — the one thing a re-nested client could not hand back.

`PadiSurfaceClient` is the spec-derived read face PLUS collection reads:

```ts
type PadiSurfaceClient = {
  readonly surface: SurfaceReadFace<typeof padiSurface.spec> &
    SurfaceCollectionsReadFace<typeof padiSurface.spec>;
};
```

The framework's `SurfaceReadFace` deliberately declines collections (it exists for
a PROJECTION's `deps`, which never walks one). padi's clients do —
`watchTerminals` enumerates `terminals.keys`, the TUI reads a record by key — so
the two read verbs (`keys`, `get`) are spelled in `dial.ts`, once, in the same
shape and on the same sides `buildSurfaceFace` mints them. **If `@kolu/surface`
later absorbs collections into `SurfaceReadFace`, delete
`SurfaceCollectionsReadFace` from `dial.ts`.**

Two shape changes every consumer sees, both from the Effect port: a PROCEDURE
takes the **Encoded** side of its input (D2/#13); a CELL / STREAM / EVENT /
COLLECTION read returns a lazy `Stream` **synchronously** (was
`Promise<AsyncIterable>` + an `AbortSignal` option). Cancellation is fiber
interruption (D10/#18).

### 2.3 `dialPadiHello` / `connectPadi`

```ts
type PadiDial = { socket; client: PadiDaemonClient; hello: PadiHello;
                  dispose: () => Promise<void> };   // `dispose` is NEW and ASYNC
```

One `stdioLink({ group: padiDaemonGroup, read: socket, write: socket })` over the
WHOLE daemon group, then both faces over its one dispatch. `dispose()` is the
**only** thing that releases the link's protocol fibers — destroying the socket
alone now leaks one per dial. `connectPadi`'s `DaemonConnection.dispose` stays
SYNCHRONOUS (the supervisor calls it from paths that cannot await), so it FIRES
the async release and swallows a rejection at that one edge, visibly.

### 2.4 `dialPadiViaHost` — a decision that needs recording

```ts
function dialPadiViaHost(host: string): Promise<AgentDial>   // was AgentDial<PadiDaemonContract>
```

`dialAgentOnce` now takes a `Surface<S>` and builds ONE face from it. padi passes
a hand-composed `padiRemoteDialSurface` = padi's SIBLING spec/tagPrefix carried
over the FULL `padiDaemonGroup`, because `sshConnector` reads `.group` to open the
link and walks `.spec`/`.tagPrefix` to build the face — splitting the two is the
only way to dial a two-sibling daemon through a one-surface connector. So
`dial.client` is the **padi face** (what both consumers want).

The compatibility gate therefore moved from the frozen control-core `hello` to
padi's own `identity` cell. They are the SAME FACT — padi seeds `identity` at boot
from the same source constants `hello` reads, never re-derived (see
`PadiIdentitySchema`), precisely so a per-host consumer reads the RUNNING padi's
identity directly (P3). It is sound HERE because this is a **refuse-only** gate: a
one-shot dial never drains or converges a running padi (#1313), so its only two
outcomes are "proceed" and "fail loud", and an unreadable `identity` produces
exactly the refusal a version mismatch does. Within a protocol epoch the two reads
are interchangeable; across one neither is reachable.

**The reason it is not simply the control core**: `sshConnector` never hands the
link's `dispatch` back, so a consumer of `dialAgentOnce` cannot build a second
sibling's face. If `AgentDial`/`Connection` ever carries `dispatch` (a ~3-line
additive change in surface-remote), swap the probe for
`padiClientOver(dial.dispatch).control.surface.core.hello()` and delete the note
in `dial.ts`. **`remotePadiBinding.ts` (W4) has the same constraint** — it builds
its own `Connector` but still goes through `sshConnector`, which owns the link.

## 3. The declared-error vocabulary (PLAN D4) — NEW `src/errors.ts`

Eleven `Schema.TaggedErrorClass`es, re-exported from `@kolu/padi/surface`.

| class | id | fields | declared on |
|---|---|---|---|
| `TerminalNotFound` | `padi/TerminalNotFound` | `id` | `lifecycle.{create,kill,wake}`, all six `chrome.set*` (not `setActive`), `screen.{state,text,history}`, `scratch.write`, `transcript.exportHtml` |
| `TerminalParentCycle` | `padi/TerminalParentCycle` | `childId`, `parentId`, `reason: "self"\|"wouldCycle"\|"parentInCycle"` | `chrome.setParent` |
| `ScratchWriteRejected` | `padi/ScratchWriteRejected` | `reason` | `scratch.write` |
| `PreviewTooLarge` | `padi/PreviewTooLarge` | `limitBytes` | `preview.read` |
| `TranscriptNoAgent` | `padi/TranscriptNoAgent` | — | `transcript.exportHtml` |
| `TranscriptNotFound` | `padi/TranscriptNotFound` | `agentKind`, `sessionId` | `transcript.exportHtml` |
| `KavalContractSkew` | `padi/KavalContractSkew` | `daemonVersion`, `requiredVersion` | `lifecycle.recycleKaval` |
| `FileGone` | `padi/FileGone` | `path` | every `fs.*`, `git.{getStatus,getDiff,worktreeRemove}` |
| `WorktreeBaseBranchMissing` | `padi/WorktreeBaseBranchMissing` | `detail` | `git.worktreeCreate` |
| `WorktreeNameCollision` | `padi/WorktreeNameCollision` | `detail` | `git.worktreeCreate` |
| `GitFailed` | `padi/GitFailed` | `detail` | every fs/git member |

Plus two named unions (`FsGitReadErrorSchema`, `WorktreeCreateErrorSchema`) and
one closed `PadiErrorSchema`.

Messages are reproduced VERBATIM from the `ORPCError` era, so an operator reading
a log or a toast sees the same sentence; what changed is that a consumer narrows
on `_tag` and reads the payload off the value instead of scraping it out of prose.
Round-trip (`encode → JSON → decode → encode`) with tag, data, message and BYTES
intact is pinned, and a NEGATIVE test enumerates exactly which 25 procedures
declare an error — so a member cannot quietly acquire or lose an error channel.

**What is deliberately NOT declared.** `unwrapGit`'s three
`INTERNAL_SERVER_ERROR` codes (`GIT_FAILED`, `NOT_A_REPO`, `PATH_ESCAPES_ROOT`)
collapse into ONE `GitFailed` — they already spelled one wire code and were
indistinguishable to every consumer, so folding them preserves exactly today's
distinguishability rather than minting discriminants nobody branches on. The
`match` stays exhaustive, so a new `GitResult` code is still a compile error.
`GitFailed` stays DECLARED rather than becoming a defect because `unwrapGit`
exists so a git error surfaces WITH ITS MESSAGE, and that message is what the user
reads.

**The stream asymmetry, stated rather than hidden.** `requireTerminal` also guards
the `terminalAttach` stream and the `terminalExit` event, but a `StreamSpec` /
`EventSpec` has no error channel to declare on. There `TerminalNotFound` is an
UNDECLARED failure ⇒ a defect: narrowable in-process, opaque across a wire hop.
Same call kaval made for its five streams, and `reattachingDeltas` is written for
it — it narrows kaval's `PtyNotFound` **structurally, on the `_tag`**, with the
tag string read OFF the class (never re-spelled), and a new test proves a
REHYDRATED plain `{_tag:"PtyNotFound"}` is recognised.

## 4. Schema mapping applied (PLAN #17 is LAW)

| zod | Effect Schema |
|---|---|
| `z.string()` / `z.boolean()` / `z.number()` | `Schema.String` / `Schema.Boolean` / `Schema.Number` |
| `z.number().int()` | `Schema.Int` |
| `z.number().int().positive()` / `.nonnegative()` | `PositiveInt` / `NonNegativeInt` (named once in `surface.ts`) |
| `z.string().min(1)` | `Schema.String.check(Schema.isMinLength(1))` |
| `z.string().uuid()` | `Schema.String.check(Schema.isUUID())` |
| `z.enum([...])` | `Schema.Literals([...])` |
| `z.record(z.string(), z.string())` | `Schema.Record(Schema.String, Schema.String)` |
| `z.discriminatedUnion("kind"\|"state"\|"active", …)` ×10 | `Schema.Union([Schema.Struct…])` — **never** `Schema.TaggedUnion`: these discriminants are `kind`/`state`/`active`, not `_tag`, and their bytes are on disk |
| `X.optional()` | **`Schema.optionalKey(X)`** — never `Schema.optional` |
| `X.nullable()` | `Schema.NullOr(X)` |
| `.default(v)` ×5 | `X.pipe(Schema.withDecodingDefaultKey(Effect.succeed(v)))`; `Effect.sync(() => [])` for the three array defaults, so each decode gets its OWN array |
| `.merge(B)` ×14 + `.extend({…})` ×3 | `Schema.Struct({ ...A.fields, ...B.fields })` — spread order = declaration order = encoded key order |
| `TerminalSnapshotSchema.pick({…})` | `TerminalSnapshotSchema.mapFields(Struct.pick([...]))` |
| `KavalSkewVersionsSchema.shape` spread | `.fields` spread |
| `z.never().optional()` ×11 | `Schema.optionalKey(Schema.Never)` — VERIFIED to reject a present value, see below |
| `.parse` (3 in-process sites) | `Schema.decodeUnknownSync` (same fail-fast semantic) |
| `AgentKindSchema.safeParse` | `Schema.decodeUnknownResult` + `Result.isSuccess` (a BRANCH, so a corrupt on-disk ref still falls to `legacyMostRecent` instead of dropping the terminal) |
| `z.infer<S>` (~45 sites) | `typeof S.Type` |
| `satisfies z.ZodType<T>` | `satisfies WireSchema<T>` |

### review #11 — the eleven anti-fields, ANSWERED

`Schema.optionalKey(Schema.Never)` **does** reject a present value — measured
against effect@4.0.0-beta.102, not assumed. `vocabByteCompat.test.ts` pins all
three `DaemonStatus` arms in both directions: the baseline decodes, every
anti-field REJECTS a present value **and** an explicit `undefined`, and
`socketPath` (a real field on two arms) still decodes. So the anti-fields have
teeth and cannot rot into a no-op.

### review #17 — the defaults, in BOTH directions

`withDecodingDefaultKey` reproduces zod `.default(v)` exactly on the wire:
accept-missing on decode, emit-key on encode, decoded key always present. It is
STRICTER on in-memory `undefined` (rejected), which is correct for a wire/disk
field and is pinned negatively at every site. **Consequence for in-process
callers: build these objects by OMITTING the key, never by spelling
`undefined`.** Affected: `activeTerminalId`, `resumeAgents` (×2),
`finishedIds`/`workingIds`/`lingerIds`, `collapsed`.

## 5. Byte-fixture inventory

Every hit-list format is pinned on the encoded JSON **string**, both directions.

`src/vocabByteCompat.test.ts` (NEW, 15 tests):
- **`SavedSession`** (padi conf store AND the user-exportable
  `kolu-session.json`): a minimal ACTIVE record and a fully-populated SLEEPING
  record round-trip byte-for-byte; a legacy blob omitting `activeTerminalId`
  decodes to `null` AND re-encodes WITH the key; an explicit `undefined` is
  rejected; `resumableIds` stays ABSENT (never `null`); an unknown key is DROPPED
  (the tolerant-read policy); a record with no `state` is REJECTED and the
  backfill ladder repairs it; the pre-cutover backfill rebuilds `pr` +
  `restoreTarget` and drops `agentSession`; a CORRUPT `agentSession` falls to
  `legacyMostRecent`.
- **`PersistedSnapshot`**: exactly `cwd · git · pr`, in order, live half dropped
  structurally.
- **`DaemonStatus`**: the anti-field battery (§4) + the encoded bytes of the
  `connected` and `incompatible` arms.

`src/surface.test.ts` (24 tests): the four-key `PadiUrgency` rolling-deploy
fixture (accept-missing, emit-key, undefined-rejected, per-decode array
identity); `identity`'s absent `lifetime` re-encoding ABSENT.

`src/chromeVocab.test.ts`: `collapsed`'s backfill re-encodes WITH the key; a
populated record round-trips byte-for-byte; explicit `undefined` rejected;
`selectedFileByMode` absent stays absent.

`src/transcript/transcriptSchema.test.ts`: the two-key wire form.

## 6. `publisher.ts` (PLAN D7)

`MemoryPublisher` from `@orpc/experimental-publisher/memory` →
`inMemoryPublisher()` from `@kolu/surface/server` — the repo's OWN publisher, the
existing source of truth for exactly this shape.

`terminalsDirtyChannel` and `notifyDirty` keep their semantics verbatim. The
channel stays on `publisherChannel(publisher, "terminals:dirty")` — for the ABORT
contract, not for ordering: `publisherChannel` wraps the iterator in
`iterateUntilAborted`, so the autosave gate's `for await` ENDS quietly on abort
rather than rejecting.

**Ordering: already proven upstream, no padi-side test added.** The shared
instance's cross-channel ordering is load-bearing (`kill.feature`), and
`@kolu/surface`'s `streamOrdering.test.ts` states BOTH of D3's opposing invariants
implementation-independently and runs them against `implementSurface` over these
very primitives. padi's use differs in no way from what those tests exercise —
one publisher, named channels, `publisherChannel` adapters — so a padi-side
duplicate would pin the same mechanism twice and drift.

`publisherSize()` changed MEANING, honestly: the retired library publisher's
`size` (pending events + listeners across every channel) has no counterpart, and
inventing one would mean reaching into the framework's private channel map or
keeping a parallel tally that can disagree with it. It now reports the LIVE
subscriber count on the one channel this module owns, tallied at the single seam
every subscription passes through. It still answers the question the readout
exists for ("is something failing to unsubscribe?").

## 7. Gates

```
pnpm --filter @kolu/padi exec vitest run <the 12 slice-A test files>
  → 12 files, 104 passed / 8 skipped, ALL GREEN
    (the 8 skips are dial.test.ts's real-daemon suite, gated on KOLU_DAEMON_TESTS=1;
     they cannot pass until slice B migrates daemonBoot)

biome lint --error-on-warnings <29 owned files>   → clean
biome format --write <29 owned files>             → clean (scoped, not repo-wide)

grep 'from "zod"' / 'from "@orpc'  across all 29 owned files → ZERO
tsc --noEmit: every slice-A source AND test file is at ZERO errors.

pnpm --filter kolu-common typecheck  → **0 errors**
pnpm --filter kolu-common test:unit  → **7 files / 96 tests, ALL GREEN**
```

`kolu-common` is un-redded exactly as its W3 report predicted: `HostDaemonInventorySchema`
is now an Effect `WireSchema`, `vocab.ts`'s `.pick`/`.merge`/`.safeParse`
import-time crashers are gone, and `NewTerminalPolicySchema` /
`DEFAULT_NEW_TERMINAL_POLICY` / `newTerminalPolicyEqual` keep their names.

### The ONE slice-B file touched

`terminalEndpoint/local.ts:444` — `PersistedSnapshotSchema.shape` → `.fields`.
A one-token change, forced because it runs at MODULE SCOPE: `Object.keys(undefined)`
threw at import and took `terminals.acyclicParent.test.ts` (a slice-A test) down
with it. Nothing else in that file was touched.

---

## 8. Hand-offs to SLICE B — every file my changes break, with the shape to consume

### 8.1 `servePadi.ts` — the handler record

1. **Declared errors are RAISED, not constructed from an injected map.**
   `recycleKaval: async ({ errors }) => … throw errors.KAVAL_CONTRACT_SKEW({message, data})`
   becomes `throw new KavalContractSkew({ daemonVersion, requiredVersion })`. The
   `errors` handler argument no longer exists (`Rpc.make` takes ONE error schema).
2. `scratch.write`'s `throw new ORPCError("BAD_REQUEST", { message: reason })` →
   `throw new ScratchWriteRejected({ reason })`.
3. `snapshotSession`'s `resumableIds` assignment (`servePadi.ts:294`) — the
   decoded `SavedSession` is `readonly`. Rebuild the object (`{ ...session,
   resumableIds }`) rather than assigning into it.
4. Every stream/event `source: async function*(input, signal)` must become a
   `Stream` (D10/#18) — that is the bulk of the remaining red in this file, and
   it is the framework's shape change, not mine.
5. `terminalAttach`'s handler raises `TerminalNotFound` on an UNDECLARED channel
   (a stream has no `error`), i.e. as a DEFECT. That is deliberate and documented
   in `errors.ts`; do not try to declare it.

### 8.2 `terminalEndpoint/local.ts`, `terminals.ts`-adjacent registry writers

6. **Decoded Effect types are `readonly`.** I mitigated the registry's half:
   `vocab.ts` now exports `AuthoredActiveTerminal` / `AuthoredSleepingTerminal` /
   `AuthoredParkedTerminal` / `AuthoredTerminal` / `TerminalClientMetadata` through
   a homomorphic top-level-MUTABLE projection (`Authored<T>`), because
   `entry.meta.<field> = x` is padi's own authored record with ONE writer. Every
   `entry.meta.*` assignment in `local.ts` therefore still compiles. What does
   NOT: `entry.info.pid = …` (`local.ts:848`) and any mutation of a decoded
   `SavedSession` / `PadiTerminal` / activity-feed array — those are wire values
   and stay `readonly` on purpose. Rebuild, don't assign.
7. `.parse` / `.shape` on any padi schema → `Schema.decodeUnknownSync(S)(x)` /
   `S.fields`. Sites: `local.ts:523,538`, `session/sessionRestore.ts:484`,
   `terminals`-adjacent test files (`session/session.test.ts:84`,
   `terminalEndpoint/adopt.test.ts:92,102,111`,
   `terminalEndpoint/sleepWake.test.ts:268`, `servePadi.test.ts:90,109,181,182`,
   `createInputFence.test.ts:19`).
8. `bridgeStream` / `resubscribeStream` — kaval's stream members are now
   `(input) => Stream<T>`, synchronous and LAZY. See kaval-report §5's laziness
   trap: a tap that must not miss an event it is about to cause has to be
   RUNNING, not merely constructed.

### 8.3 `ptyHost/connect.ts` + `hostInventory.ts`

9. `kavalDaemonContract` and `KavalDaemonRouter` are **deleted** in kaval. Dial
   over `ptyHostSurface.group.merge(kavalControlSurface.group)` (or
   `kavalDaemonGroup`) and build faces with `ptyHostClientOver(link.dispatch)` /
   `buildSurfaceFace(kavalControlSurface, dispatch).surface.core`.
   `unixSocketLink`/`stdioLink` take `{ group, … }` and return
   `{ dispatch, dispose }`; `dispose()` is ASYNC and is the ONLY thing that frees
   the protocol fibers. `UnixSocketConnection` no longer exists.
10. **`isMissingFrozenFragment` is retired in meaning.** I kept the module and
    re-implemented it honestly on the new signal (an unimplemented tag arrives as
    a defect whose value is `"Unknown request tag: <tag>"` — measured, not
    recalled). But its ORIGINAL caller was tolerance for a live PRE-UW5 kaval,
    which is now CROSS-EPOCH: its framing is the retired oRPC peer protocol, so a
    dial never reaches route resolution and the predicate can never fire for it.
    **The tolerance branches are dead from this epoch forward and should be
    deleted** — `connect.ts:125` (`readKavalHandshake`'s hello catch),
    `connect.ts:302` (`probeKavalForConvergence`'s `probePreFragmentKaval` arm,
    and `probePreFragmentKaval` itself), `hostInventory.ts:166` (the
    `commit → null` arm). A cross-epoch kaval degrades gracefully by the schema's
    own design: `RunningKaval`'s `buildCommit`/`contractVersion`/`terminalCount`
    are all honestly-nullable. Delete the module with the last branch.
11. `ptyHost/processTarget.test.ts:37,41` still hardcode `contractVersion: "6.0"`
    — kaval's `PTY_HOST_CONTRACT_VERSION` is now `"7.0"` (kaval-report §7.7).
    `upgradeWindow/previousRelease.e2e.test.ts:541,585` carry the same stale
    string in prose + assertions.

### 8.4 `daemonBoot/`

12. `daemonMain.ts:341,533` — `SurfacesRuntime` has no `.router`; the spine's
    `DaemonSpec` takes flat `{ group, handlers }` (kaval-report §2.4). Serve
    `padiDaemonGroup` + the bound handlers.
13. `daemonBoot/controlCore.ts:54,55` — the control-core cell/procedure handlers
    must return `Effect`s (or Streams), not bare values.
14. **PLAN #11**: any new daemon-lifecycle disk artifact from the Layer rewrite
    must be registered in `upgradeWindow/sharedArtifacts.testlib.ts` in the same
    commit.
15. **PLAN #24**: `session/reconcile.test.ts`, `session/session.test.ts`,
    `terminalEndpoint/sleepWake.test.ts` are ledger-frozen by file path AND test
    title. Moving or renaming one needs a `coverage-ledger.yaml` row in the same
    commit; run `just --no-deps test-e2e-governance` pre-flight.

### 8.5 `watch.ts`

16. `client.surface.terminals.keys({}, { signal })` →
    `client.surface.terminals.keys(undefined)` returning a `Stream`;
    `terminalAttach.get(input, o)` / `terminalExit.get(input, o)` →
    `(input) => Stream`, no options bag, no signal. The face type
    (`PadiSurfaceClient`) already spells all three — see §2.2.

### 8.6 Not slice B, but downstream of the same break

- **`packages/client/src/kaval/useDaemonRestart.ts:76`** —
  `isDefinedError(error) && error.code === "KAVAL_CONTRACT_SKEW"` →
  `error._tag === "KavalContractSkew"`, and `isDefinedError`/`safe` changed shape
  (S3 §7). W5.
- **`packages/server/src/padi/*`** — `PadiDaemonClient` is `{dispatch, padi,
  control}`; `padiConvergence.ts`, `padiBinding.ts`, `remotePadiBinding.ts`,
  `padiSession.ts` all thread it. `scopePadiSurface` keeps its name and signature
  shape. W4.
- **`packages/kolu-cli` / `packages/padi-tui` / `packages/kolu-mcp`** —
  `dialPadiViaHost(...).client` is now the PADI face directly (see §2.4);
  `scopePadiSurface` no longer applies to it. `mountStreamRetry` must be rewritten
  against `Stream` members. W5.

## 9. API-break list additions (drishti / odu follow-up)

1. `PADI_SURFACE_VERSION`: `"4.7"` → `"5.0"`.
2. `PadiDaemonClient` is `{dispatch, padi, control}`, NOT a
   `ContractRouterClient`. `PadiSurfaceClient` / `PadiControlClient` are
   spec-derived faces. NEW export `padiClientOver`.
3. `padiSurface.contract` / `padiDaemonContract.surface.*` **deleted**. NEW:
   `padiDaemonGroup`, `padiSurfaceSibling`, `padiControlSibling`,
   `PADI_DAEMON_TAG_COUNT`.
4. `ProcedureSpec.errors` (code map) → `error` (one Schema). The
   `KAVAL_CONTRACT_SKEW` code is now the `KavalContractSkew` class.
5. NEW module `@kolu/padi/surface`'s error vocabulary (11 classes + 3 unions).
6. Every exported schema is an Effect `Schema`: `.shape` → `.fields`, `.parse` →
   `Schema.decodeUnknownSync`, `.safeParse` → `Schema.decodeUnknownResult`,
   `z.infer` → `typeof S.Type`. **Encoded bytes unchanged** (byte-pinned), so
   nothing on the wire or on disk migrates.
7. Decoded values are `readonly` — EXCEPT the four authored/registry types, which
   are deliberately top-level-mutable (§8.2/6).
8. `PadiDial.dispose` is NEW and ASYNC; `dialPadiViaHost` returns the padi face.
9. `publisherSize()` counts live `terminals:dirty` subscribers, not the retired
   library publisher's `size`.

## 10. Nothing here invalidates a PLAN assumption

- **D6** holds, with the version-constant bullet followed literally and the epoch
  documented in the same commit that changes the wire.
- **D4** is realised on both channels, and the one place the framework cannot
  declare (streams/events) is named and attributed rather than papered over.
- **D7** is realised by reusing the existing source of truth; the ordering spec
  stays where it is already proven.
- **D1/#16** is closed by construction (sibling prefix) AND by assertion (an
  import-time size check + a literal key set).
- **#17** is applied field by field, with byte fixtures for every hit-list shape.
- **#11** is ANSWERED, not assumed: the anti-field construct rejects a present
  value, and a test says so.
- **D2/#13** lands where it bites: procedure/stream/event inputs are the Encoded
  side; cell/collection keys and values stay decoded (S3's rule).
- **PLAN rule 8**: three `as unknown as` casts were added, all in `dial.ts`/its
  test, all the same structural cast `surfaceClientRef` and `ptyHostClientOver`
  make for the same reason (`SurfaceFace` is deliberately structural per D2), each
  with the constraint recorded. No `noExplicitAny` override was added anywhere.
- No `package.json` `dependencies` block changed ⇒ standing rule 5 does not fire.
