# W4 — `padi` SLICE B2: the upgrade-window harness for the wire epoch

Scope delivered: all of `packages/padi/src/upgradeWindow/**` (the 21 `tsc` errors
B1 handed off, the three live unit failures, and the D6/#1/#19 harness rewrite),
plus B1 §8's hand-off — `ptyHost/index.ts`'s three `let`s and forwarding `Proxy`
collapsed into one `Ref`-backed `Context.Service`, landed as its **own commit
first**.

`package.json` is UNCHANGED — no dependency edge moved, so PLAN standing rule 5
does not fire. `ci/mod.just` is UNCHANGED, so `ciRecipe.watchdog.test.ts` stays
green by construction. No `coverage-ledger.yaml` file is touched: the three
ledger-frozen padi unit files (#24) are not in this slice, and the one file this
slice renames was verified not to be ledger-referenced.

---

## 1. The ptyHost endpoint service (commit 1, B1 §8)

`ptyHost/index.ts` carried four pieces of module state: `let endpoint`, `let
triggerRestart`, `let infoPromise`, and a hand-rolled forwarding `Proxy`. They are
now one named service over two `Ref` cells:

```ts
class PtyHostEndpointState extends Context.Service<PtyHostEndpointState, {
  current: Ref<{ endpoint, restart } | undefined>
  restart: (steps) => Promise<void>
  info:    () => Promise<PtyHostSystemInfo>
}>()("padi/ptyHost/PtyHostEndpointState") {}
```

Two things this buys that three `let`s could not:

1. **The endpoint and its restart trigger are ONE atomically-swapped value.**
   `serializeRestart(ep)` carries the coalescing + emit-guard state for the
   endpoint it was built over. Two independent cells can express a half-update —
   a trigger coalescing restarts onto a daemon nobody holds — and one value
   cannot. `__setEndpointForTest` and `ensureLocalEndpoint` now both go through
   one `holdEndpoint(ep)`, so the two writers cannot drift.
2. **The forwarding Proxy is gone.** `ptyHostClient` is built ONCE by the
   framework's own spec-derived walk (`ptyHostClientOver`) over a dispatch that
   resolves the current connection per call. The member set, the tags and the
   input decoding are now *exactly* the live client's, because they come from the
   same walk — where the Proxy string-walked a nested object and could silently
   address a member the surface does not have.

### 1.1 Why the module still holds ONE instance

`PtyHostEndpointState` is a `Context.Service`, so the class is also the `Context`
key and a future boot graph can PROVIDE this value. Nothing here READS it out of
a context, and that is deliberate for exactly the reason padi-B1 §1.2 gives: every
consumer of `ptyHostClient` is synchronous domain code deep inside non-Effect call
stacks. Reads are therefore `Ref.getUnsafe` and writes are `MutableRef.set` on the
same cell — a cell read, no fiber, and **no new `Effect.run*` edge** (PLAN #25).
padi's daemon tier still has exactly the two run sites B1 named.

### 1.2 Behaviour preserved, deliberately

- **The eager synchronous throw stays eager.** `liveDispatch()` throws as the
  member is INVOKED, before any Promise or Stream exists — which is the shape
  `resubscribeStream`'s guard (`terminalEndpoint/local.ts`) is written against.
  `streamRef`/`unaryRef` both call `dispatch.*` at call time, so the timing is
  byte-for-byte what the Proxy did. (`bridgeStream.test.ts`'s
  eager-synchronous-throw guard is green, unchanged.)
- **The `system.info` cache keeps PROCESS lifetime.** It is not cleared on a
  recycle, and that is now stated in the code rather than implied: every field
  kaval reports there derives from its daemon HOME (`rcDir` is `home.file("rc")`)
  or from the machine, both of which a recycle at the same rendezvous preserves.

### 1.3 The one API-shape change

`KavalConnectionMetadata` gains `dispatch: SurfaceDispatch` — the transport seam
the stable face forwards onto. It rides the METADATA channel because that is
padi's own process-internal channel (the same one `pid` and `lifetime` ride);
`daemonStatus.ts` reads metadata by named field and never spreads it, so nothing
wire-facing is affected. Three fakes had to supply one, and they do so through a
new `ptyHost/dispatch.testlib.ts` with two kinds:

- `unreachableDispatch` — for an identity-only fake connection; any member reached
  through it dies by name rather than resolving `undefined`;
- `scriptedDispatch(answer)` — keyed by member TAG, used by `restartLocal.test.ts`
  (whose fake daemon answers exactly one member, `terminal/killAll`).

`restartLocal.test.ts`'s delicate drain→park timing fixture is otherwise
untouched, and its ORDERING GUARD still fires in the empty-registry window.

---

## 2. `src/upgradeWindow/**` — what each file now proves

### 2.1 `oldSessionFile.test.ts` — the `.parse` swap, with #17 stated

`SavedSessionSchema.parse` → a module-scope `Schema.decodeUnknownSync(...)`.
The interesting part is WHY the swap is safe here and is written into the file:
`activeTerminalId` carries a KEY-level decoding default, so a blob that OMITS the
key still backfills to `null` (which is the previous shape planted), while an
in-process caller that SPELLED `activeTerminalId: undefined` would now be
rejected. `backfillSavedSession` spreads only present keys and never writes an
explicit `undefined` — verified by reading every one of the four backfills — so
the named-recovery law holds unchanged. All three tests green.

### 2.2 `socketContractMismatch.test.ts` — off zod

The hand-built `defineSurface`/zod contract is replaced by a
`RpcGroup.make(<live Rpc from kavalDaemonGroup>)` fake, the model
`ptyHost/connect.test.ts` and kaval's `contractSkew.test.ts` share: naming a tag
kaval does not serve is an error, so the fake cannot drift from the surface it
imitates. The fake now serves BOTH handshake surfaces at the same version (the
frozen hello and `system.version`), because within this epoch a peer that answers
only one is a different failure — pinned elsewhere.

What it still asserts, and `connect.test.ts` does not: the typed
`DaemonContractSkewError` brand — `subject`, `isContractSkew`, `requiredVersion`
and the skewed daemon's own `pid` (the third identity attestation the
gate-less-squatter recovery needs when no connection was ever established).

### 2.3 `kavalFragmentAbsent.test.ts` → `yesterdayKaval.test.ts` (renamed)

The old file asked what a kaval WITHOUT the frozen control-core fragment does. As
a PREVIOUS RELEASE that peer cannot exist this epoch: a kaval predating the frozen
fragment also predates this wire, so its first frame does not decode and a dial
never reaches route resolution. Its in-epoch successor (a peer that speaks this
wire and serves a narrower member set) is already pinned at
`ptyHost/connect.test.ts` — so re-stating it here would have been a duplicate.

The file is re-framed as the two SIDES of the epoch boundary, both driven through
padi's own `probeKavalForConvergence` (the probe padi hands to `createEndpoint`):

| arm | what it pins |
|---|---|
| **cross-epoch** | a survivor that answers our first frame with bytes we cannot parse is classified AT THE DECODE as `UnspeakableProtocolError` — with `socketPath` and the JSON-quoted `frame` as FIELDS. Never `null` (absence is reserved for "no listener"), never a degraded identity (what the deleted fallback produced), and **not** the corroborated `UnspeakablePeerError` — only the endpoint, which owns the gate and verifies the holder pid, may mint the verdict that buys a SIGTERM. |
| **in-epoch** | a survivor that speaks this wire but was built from another tree is a BUILD mismatch: probe yields an identity, `decide` returns `report-mismatch`, kaval's `nudge-human` policy takes no action. This is the arm an ordinary upgrade rides, and the epoch break must not have moved it. |

The cross-epoch fixture plants the previous-epoch greeting by hand
(`"EVENT: hello\ndata: {oh no}\n\n"` on a bare `net.createServer`), deliberately:
the framework fixture's socket accepts and stays SILENT, which is the 30 s hello
deadline — a different failure. Answering promptly in the wrong language is what
review #9 is about, and only a byte-level fixture can say it.

### 2.4 `previousRelease.e2e.test.ts` — the D6/#1/#19 rewrite

**Readiness probes are transport-neutral.** A previous-release daemon's readiness
is read the only two ways that survive a protocol epoch: the rendezvous ACCEPTS a
bare `net.connect()`, and the pid GATE beside it names a live holder. Nothing is
spoken on the socket. (The old probe dialed a `unixSocketLink` and called
`system.heartbeat` — the handshake review #19 showed can never complete, so the
suite would have failed at the FIXTURE, before any assertion ran.) Both legs go
through one `waitForNeutralReadiness(socket, gate, label)`; `waitForSocket`'s
injected-probe seam made this a parameter change, not a testlib change.

**`newReadsOld`'s "compatible contract ⇒ adopt" arm is permanently the RECYCLE
arm**, and the file says so. The order is now:

1. boot the previous-release kaval; neutral readiness; the one-field gate body
   pin (#2011 pid-first law) kept verbatim;
2. **the premise, measured rather than assumed** — this build's
   `probeKavalForConvergence` must NOT resolve against the previous-release
   daemon: not an identity (which would mean the epoch never broke, or the window
   collapsed to same-version) and not `null` (absence is reserved for "no
   listener", and accepting it would let a fresh daemon race a live one for the
   rendezvous). The failure message names both traps;
3. boot CURRENT padi (its own dial is the readiness probe — padi here is
   current↔current, and the calls below need the connection anyway);
4. **the recycle arm**: the previous-release pid no longer holds the gate, that
   process is DEAD, a live replacement holds it, and the same probe that could not
   read the survivor now reads an identity at `PTY_HOST_CONTRACT_VERSION`. That
   last clause is what distinguishes "recycled to a current-epoch daemon" from
   "adopted the old one"; the old test's "we accept either — old pid still live OR
   already recycled" is deleted, because within this epoch only one outcome is
   reachable and accepting both would let a same-version collapse pass;
5. terminal create → autosave persisted → **shared-artifact inventory clean
   (#11)** → `recycleKaval` → daemon replaced, old dead → session survived → padi
   still up → **inventory clean again**. Verbatim from the old file.

**On the observation KIND.** The brief asks the harness to assert the supervisor's
actual observation kinds. It does — but at the layer that owns the bytes. The
CLASSIFICATION (`UnspeakableProtocolError`, at the decode) is pinned in
`yesterdayKaval.test.ts` against a fixture this repo controls; the e2e owns
neither the previous binary's bytes nor its framing, so pinning a specific error
class there would be a guess about a released artifact. What the e2e pins is the
CONSEQUENCE the kind produces: the probe never yields an identity, and the boot
replaces the survivor with a current-epoch one. That split is stated in the file's
header so a later reader does not mistake it for an omission.

**`oldReadsNew` is re-scoped to what remains meaningful.** The old arm dialed a
PREVIOUS-release padi with the CURRENT client (`recycleKaval`, then read its
replacement's gate) — review #19's blocker, structurally unreachable now. What
survives, and is asserted:

- **(a)** the CURRENT kaval's own dial completes at this rendezvous over this
  transport (`connectKaval` → contract version + pid). This is the **positive
  control** that makes (c) non-vacuous, and it is the "current-kaval dial arm" the
  brief names as unaffected;
- **(b)** a previous-release padi meeting a new-epoch kaval does not die: it claims
  its gate and stays up. An old build must not crash when it finds a daemon from
  the future — the rollback story, readable without speaking padi's protocol at
  all (padi claims its gate BEFORE it serves);
- **(c)** this build cannot complete a padi handshake against it — bounded at 30 s,
  asserted as `not "connected"`, because a peer from another epoch may answer
  unparseably OR not answer at all and either way what is proven is that no usable
  connection appears;
- **(d)** whoever now holds the kaval rendezvous, the gate is PID-FIRST readable and
  names a LIVE process (#2011). The old file's assertion (c) — the same law — is
  kept; its claim about WHICH kaval ends up there is dropped, because that is the
  previous release's internal choice and not ours to predict.

`KOLU_UPGRADE_WINDOW_REQUIRE` and every anti-collapse guard are untouched: version
tag required, previous store ≠ current store, `logWindow`'s greppable evidence
lines, and `resolvePreviousWindow` byte-identical (so the non-CI skip guard —
`REQUIRE` unset + no version tag ⇒ warn and return — behaves exactly as before).

The `it()` timeout moves 300 s → 420 s, with the reason in place: two waits are now
DEADLINES on a peer that may never answer (the classification in `newReadsOld`,
the cross-epoch dial in `oldReadsNew`) where both legs previously completed
handshakes in milliseconds. The individual bounds are what keep the suite honest;
the ceiling only has to exceed their sum.

---

## 3. Gates

| gate | result |
|---|---|
| `pnpm --filter @kolu/padi typecheck` | **0 errors, package-wide** (was 21) |
| `KOLU_DAEMON_TESTS=1 … test:unit` (all but `previousRelease.e2e`) | **67 files / 528 tests green** |
| `previousRelease.e2e` locally | **could not be run** — see below |
| `just --no-deps test-e2e-governance` | **green** — 58 features, 500 declarations, 514 executions, 606 immutable revisions |
| `biome lint --error-on-warnings packages/padi` | **clean** (144 files) |
| scoped `biome format` | applied to the touched files only |
| `zod` / `@orpc` imports in `packages/padi/src` | **zero** |
| `packages/padi/package.json` | **untouched** |

### 3.1 Why `previousRelease.e2e` did not run locally

Its guard is unchanged and works: with no `KOLU_PREVIOUS_KAVAL_BIN` the test
resolves the window itself — it fetched tags, picked the version tag, and reached
`nix build … .#kaval`, which **failed for a reason structurally outside this
slice**. That derivation runs the REPO-WIDE typecheck, and `packages/kaval-tui`
is red with ~20 errors (`UnixSocketConnection`, `servedRouter`, `.contract`,
`isDeadTransportError`) — i.e. the client/TUI tier the PLAN schedules for **W5**,
untouched by W4. So the previous-release binaries cannot be built on this branch
until W5/W6 land, and the suite cannot be exercised end-to-end here at all.

The guard itself is verified un-regressed by reading: every line of
`resolvePreviousWindow` and the `if (!window) { … }` skip is byte-identical to the
pre-slice file, so `KOLU_UPGRADE_WINDOW_REQUIRE` unset + no version tag still
warns and returns, and `REQUIRE=1` still refuses every collapse.

**Consequence for W7:** `ci::upgrade-window` is the first place this rewrite runs
for real. Its two novel assertions — step 2's "the probe must not resolve" and
`oldReadsNew` (c)'s bounded dial — are the ones to watch, because they are the two
that depend on what a RELEASED binary does with bytes from another epoch.

---

## 4. API-break list additions (drishti / odu follow-up)

Beyond A's and B1's lists:

1. **`KavalConnectionMetadata` gains a required `dispatch: SurfaceDispatch`.**
   Any consumer constructing a fake kaval `DaemonConnection` must supply one.
   padi-internal, but it is a type other suites build against.
2. **`padi/src/upgradeWindow/kavalFragmentAbsent.test.ts` → `yesterdayKaval.test.ts`.**
   Not ledger-referenced (verified); no CI recipe names it.
3. Nothing else moved: `ensureLocalEndpoint`, `restartLocalEndpoint`,
   `currentKavalProcessTarget`, `__setEndpointForTest` and `ptyHostClient` keep
   their exact signatures.

## 5. Deviations from the brief, in one place

1. **`kavalFragmentAbsent.test.ts` was re-framed and RENAMED, not converted to the
   narrower-member-set case.** B1 §7.2 offered "become the in-epoch
   narrower-member-set case, or retire with a ledger row". Neither, exactly: that
   case already exists at `ptyHost/connect.test.ts` ("REFUSES a peer that speaks
   this protocol but serves no frozen control core"), so re-stating it would have
   been a duplicate. The file instead keeps its upgrade-window subject — yesterday's
   kaval — and answers it for BOTH sides of the epoch boundary. No ledger row is
   required (the file is not ledger-referenced).
2. **The e2e does not assert an error CLASS against the previous binary** (§2.4,
   "On the observation KIND"). The kind is pinned one layer down, where the bytes
   are ours.
3. **The `it()` timeout moved 300 s → 420 s.** Title and path unchanged.
4. **`just fmt` was NOT run repo-wide.** Another agent is editing
   `packages/server`, `packages/surface-remote` and `packages/common` in this same
   worktree; formatting was scoped to the files this slice touches so no
   in-flight work is swept into these commits.
