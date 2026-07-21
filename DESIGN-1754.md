# Fix design — #1754 (fast-turn stranded `thinking`)

**Token:** RT-1754-D4TA · **Stage:** design gate (STEP 1) · **No fix code in this doc.**
**Grounded in:** `REPRO-1754.md` ("What a fix must defeat") + the verified repros.

> **This is the design gate deliverable.** Every new symbol, parameter, module
> placement, and constant below is flagged **[DESIGN-BEARING]**. The blocking
> questions are in **§7**; I recommend an option for each. **No fix code until
> your ruling.**

---

## 1. What the fix must defeat (restated from REPRO-1754.md)

1. A **single dropped/coalesced terminal edge with NO subsequent write** — the
   turn is over and the agent idle, so nothing else ever nudges the watcher.
2. A **live (non-orphaned) `thinking`** — the fix may **not** lean on claude's
   `decayTransientState`, which is deliberately disarmed for this shape
   (`recheckAt: null`, "live turn, never cleared").
3. **Grok has no fallback timer at all** — the recovery must be *added*.
4. **The whole class**, not one file format: grok (`events.jsonl`), claude
   (transcript JSONL), codex/opencode (SQLite WAL).
5. **No churn regression** past the 150 ms debounce (claude streams tokens; a
   naive tight re-read re-allocates the 256 KB tail + re-fires summary fetches
   hundreds of times/sec).
6. **No override knobs / graceful-degradation** (repo fail-fast law).

## 2. Root cause (one sentence)

Both watcher families are **purely edge-triggered** off `fs.watch` — there is a
fast path (the OS event) but **no level-triggered floor**, so a single
OS-dropped edge on the terminal append with no following write strands the
state forever.

## 3. The fix in one line

Add a **level-triggered floor** under the existing edge-triggered fast path: a
bounded **append poll** (re-stat the watched file on a coarse cadence; fire the
*existing* debounced `onChange` only when size/mtime advanced past what we last
observed by **either** path). The OS event stays the fast path; the poll only
does work when the OS actually dropped an edge.

Why this defeats each constraint:

- **(1)** The poll needs no further write — it re-stats on its own timer, so a
  missed terminal edge is caught within one interval. ✔
- **(2)** Entirely independent of `decayTransientState`; it re-reads and
  re-derives from disk (`end_turn` → `waiting`), never touching the orphan/decay
  path. ✔
- **(3)** The recovery is the poll itself — grok gains it by construction. ✔
- **(4)** It lives in **one shared primitive** all three families call. ✔
- **(5)** The poll tick is a **`stat` only**; it fires `onChange` *only on a real
  advance*, and that `onChange` is the *same* 150 ms-debounced, change-gated path
  as today — so an idle file does zero downstream work and a busy file coalesces
  to one re-read per window regardless of poll rate. ✔
- **(6)** The interval is a baked-in constant, not a knob. ✔

## 4. The primitive — `subscribeFileAppends` **[DESIGN-BEARING: name + signature]**

New module: **`packages/integrations/io/src/file-append-watcher.ts`**, exported
from `kolu-io`. **[DESIGN-BEARING: placement]** — `kolu-io` is the repo's
existing "filesystem and I/O primitives, no `kolu-*` deps" receptacle (it already
hosts `createDirFilenameWatcher`); the OS `fs.watch` append-delivery volatility
is exactly its axis, so this reuses the existing boundary rather than minting a
new package. (Electricity classification in §6.)

Proposed surface (names all **[DESIGN-BEARING]**):

```
subscribeFileAppends(
  filePath: string,
  onChange: () => void,          // the consumer's existing (debounced) handler
  opts?: {
    pollIntervalMs?: number,     // default DEFAULT_APPEND_POLL_MS
    log?: Logger,
    label?: string,              // lifecycle log label, e.g. "grok: events"
  },
): () => void                    // unsubscribe (idempotent)
```

Internal contract:

- On subscribe: install `fs.watch(filePath, …)` (the fast path) **and** start a
  self-rescheduling `setTimeout` poll (never `setInterval` — a slow `stat` must
  not stack).
- Maintain one `lastObserved: { size: number; mtimeMs: number } | null`.
  **[DESIGN-BEARING: change-detection key = `(size, mtimeMs)`]** — `mtimeMs`
  alone can collide for two writes in the same coarse-resolution second; `size`
  disambiguates an append; comparing both also catches truncation/rotation.
- On **either** an `fs.watch` edge **or** a poll tick that finds
  `(size, mtimeMs) !== lastObserved`: update `lastObserved`, then call
  `onChange()`. During healthy streaming the edge keeps `lastObserved` current,
  so the poll sees no advance and never fires — **the poll is silent unless the
  OS dropped an edge.**
- `stat` ENOENT (file gone/not-yet) → treat as "no observation", never fire, keep
  polling. A hard stat error (EACCES, …) → log at error, keep polling (surface,
  don't collapse).
- Unsubscribe: `close()` the watcher, clear the poll timer, set a `closed` guard
  so no late tick fires on a torn-down watcher.

Constant **[DESIGN-BEARING: value]**: `DEFAULT_APPEND_POLL_MS`. **Recommend
1000 ms** — reconciles a stranded state within ~1 s (the measured fast-turn
scale), against the current *infinite* strand; a `stat`/sec/session is
negligible. Not a knob.

## 5. Wiring the three families **[DESIGN-BEARING: each call site]**

| Family | Today | Change |
|---|---|---|
| **grok** | `fs.watch(eventsPath, schedule)` in `watchPath` (`session-watcher.ts:74`) | `subscribeFileAppends(eventsPath, schedule, …)`. **[DESIGN-BEARING: scope]** — `events.jsonl` only (the state signal); `summary.json`/`signals.json` are re-read on every events tick already. |
| **claude** | `fs.watch(tp, scheduleTranscriptCheck)` in `attachTranscriptWatcher` (`session-watcher.ts:246`) | `subscribeFileAppends(tp, scheduleTranscriptCheck, …)`. The dir-watch "transcript appears later" bootstrap stays as-is. |
| **codex + opencode** | `tryWatchWal` → `fs.watch(walPath, onChange)` in `wal-subscription.ts` | The **direct WAL watch** becomes `subscribeFileAppends(walPath, onChange, …)`; the existing **parent-dir inode-rearm** watcher stays (it handles WAL checkpoint/inode replacement, a different failure than a dropped append). Covers both providers via the one shared `subscribe`. |

**[DESIGN-BEARING: appearance bootstrap]** — scope the primitive to *appends on
an existing file*; leave each consumer's existing "file appears later" dir-watch
bootstrap untouched (minimal blast radius). Alternative: fold appearance into the
primitive too.

Nothing else in any watcher changes: the debounce, the change-gate
(`agentInfoEqual` / `claudeInfoEqual`), `deriveState`/`deriveGrokInfo`, and
`decayTransientState` are all **unchanged**. The poll simply guarantees the
existing handler eventually runs.

## 6. Structural review (electricity / Hickey)

- **Test ① domain-agnostic:** speaks only `filePath` + a `() => void`; no
  agent/terminal/git vocabulary. ✔
- **Test ② real volatility:** OS `fs.watch` append-delivery reliability is a
  genuine axis the system varies along (inotify vs kqueue vs FSEvents — the
  #1754 defect *is* that variance), not a bounded `===`. This is why it belongs
  behind a receptacle, not inlined.
- **Test ③ graduates:** three in-repo consumers on day one (grok, claude,
  WAL). **[DESIGN-BEARING: classification]** — I place it as a **leaf inside the
  existing `kolu-io` receptacle** (the `serve-dir`/`terminal-protocol` tier),
  **not** a new `@kolu/*`; `kolu-io` already owns this volatility and reusing it
  honors "reuse the source of truth." Open to your ruling if you want it minted
  as its own package.
- **No new complecting:** the poll and the edge feed the *same* single
  `onChange`; no second state machine, no parallel derive path.

**Considered and rejected:**
- **Re-arm `decayTransientState` for live `thinking`** — forbidden by constraint
  2 and semantically wrong (decay is *de-escalation*, not *re-read*).
- **"Read from start on attach"** (the issue's original Half-1 idea) — does
  nothing for Half 2 (append-*after*-attach); REPRO-1754 shows the tail read
  already reads the terminal state once *triggered*.
- **Migrate to `@parcel/watcher`** (repo's canonical fs monitor) — still
  edge-based (can still coalesce), doesn't provide the guarantee on its own, and
  a much larger blast radius. The poll floor is needed regardless of backend, so
  a backend swap is orthogonal and out of scope here.

## 7. Blocking questions (your ruling) — recommendation first

- **Q1 — Placement/classification.** Primitive in **`kolu-io`** as a leaf (reuse
  the existing fs-volatility receptacle) — *recommended* — vs a new `@kolu/*`
  package vs `kolu-shared`.
- **Q2 — Name + signature.** `subscribeFileAppends(filePath, onChange, opts)`
  returning `unsubscribe`, with `(size, mtimeMs)` change key — *recommended* —
  approve or rename.
- **Q3 — Poll scope.** **Always-while-subscribed** (simplest; a `stat`/interval,
  fires only on real advance, zero work on idle files) — *recommended* — vs
  only-while-the-consumer-is-in-a-working-state (leaner stat count, but the
  consumer must drive an arm/disarm signal, adding coupling).
- **Q4 — Interval.** `DEFAULT_APPEND_POLL_MS = 1000` — *recommended* — vs
  faster (lower recovery latency, more stats) / slower.
- **Q5 — WAL depth.** Wire the primitive into `wal-subscription`'s direct WAL
  watch (covers codex + opencode) while keeping its dir-watch inode-rearm —
  *recommended*. (I'll confirm opencode routes through `wal-subscription` in
  STEP 2.)
- **Q6 — grok scope.** `events.jsonl` only — *recommended* — vs also wrapping
  `summary.json`/`signals.json`.
- **Q7 — Appearance.** Keep consumers' dir-watch appearance bootstrap; scope the
  primitive to existing-file appends — *recommended* — vs fold appearance in.

## 8. STEP-2 test plan (for after your ruling — not started)

Test-first, on this branch, one draft PR closing #1754:

1. **Primitive unit test** (`kolu-io`): drop the edge (reuse the repro's
   `fs.watch` shim), advance past `pollIntervalMs`, assert `onChange` fired from
   the poll; assert an idle file never fires; assert no fire after unsubscribe.
2. **Invert the two committed repros** (`repro-1754/*.test.ts`): after a dropped
   terminal edge + one poll interval, assert the state **reconciles to
   `waiting`** (they currently assert the strand).
3. **WAL-level test** in `wal-subscription` for a dropped WAL append.
4. **Restore the four descoped e2e asserts** named in the issue:
   `claude-real`, `codex-real`/`grok-real` (thinking→waiting + working-bucket +
   token-delta), `claude-cli-real` `/compact` (`state="waiting"`), and
   session-end / sleeping daemon-restart wake (transient clear/appear window).

## 9. Sequencing dependency **[DESIGN-BEARING]** — the four descoped asserts live in unmerged PR #1751

Verified on this branch (reversible prep, no code): **PR #1751**
(`e2e-ollama-real-agent`, "exercise real agent CLIs against ollama, delete all
mocks") is **OPEN, not merged**, based on master. The four named real-agent
feature files — `claude-real.feature`, `codex-real.feature`,
`grok-real.feature`, `claude-cli-real.feature` — **do not exist on master**, so
they are **absent from this branch** (which was cut from origin/master). What
*does* exist here: `claude-code.feature` (a *mock* `/compact` "reads as idle,
not stuck" scenario), `grok.feature`, `opencode.feature`,
`sleeping-terminals.feature`.

**Implication:** on this master-based branch there is nothing to "restore" for
the `-real` asserts — the files aren't here yet. STEP 2 as literally specified
("restore the four descoped e2e asserts") cannot touch those files from this
branch.

- **Recommended sequence:** land the **fix + primitive + primitive unit test +
  the two INVERTED repro tests** (all of which live on/relative to this branch)
  on master first; **PR #1751 then rebases** on the merged fix and un-descopes
  its *own* real-agent asserts (thinking→waiting, working-bucket, token-delta,
  the `/compact` `state="waiting"`) as part of #1751. Rationale: the fix must be
  on master before #1751's full state asserts can be green, and #1751 owns those
  feature files. `sleeping-terminals.feature` (on master) *can* be restored in
  my PR.
- **Alternative:** rebase this branch onto the unmerged #1751 and restore the
  asserts here — couples two open PRs; messier.
- **Ask (Q8):** rule the sequencing — fix-first-then-#1751-restores
  (*recommended*) vs restore-here-on-a-#1751-rebase.

---

*Design gate only. Awaiting the coordinator's ruling on §7 + §9 (Q8) before any fix code.*

---

## 10. RULING AMENDMENTS — binding as-built spec (RT-1754-D4TA)

Ruling: `…/scratchpad/ruling-1754.md`; findings: `…/tasks/confirmed-1754.txt`.
Core ratified (floor under fast path, one primitive, three seams, no knobs).
Amendments below are **binding**.

**B1 — SUPERSEDED (reverted). The floor is a hand-rolled `statSync` poll, NOT
`fs.watchFile`.** B1 originally amended the floor to Node's builtin
`fs.watchFile` on ecosystem-reuse (C1) grounds. The codex-debate (xhigh) found —
and the coordinator independently verified (`ruling-1754-B1.md`) — that this
**buys a defect**: `fs.watchFile` fires only relative to a baseline it captures
on an **asynchronous first stat**, with **no readiness event**, so a change
between the consumer's attach read and that (threadpool-delayable) baseline is
folded in and never fires — a **P5 guarantee violation**, the exact #1754 strand
class merely narrower (codex reproduced it deterministically at
`UV_THREADPOOL_SIZE=1`). No startup reconciliation closes it — there is no
ordering edge to schedule against.

**As-built** `subscribeFileAppends(filePath, onChange, { intervalMs, log?, label })`:
- `observed = statKey(filePath)` captured **synchronously at subscribe** — the
  attach→baseline race is non-existent *by construction*.
- a self-rescheduling `setTimeout` poll (never `setInterval`, no stacking), the
  **sole writer** of `observed` (single-writer, P3): re-stats each interval,
  `emit`s + advances only on change. Full key **`size:mtimeMs:ino`** (ino closes
  the WAL same-size-rewrite / rotation aliases B1 credited the builtin with).
- `statSync` throws the **real errno** directly — ENOENT stays silent (keep
  polling), any other errno logs at `error`. The disambiguating `fs.stat` B1
  needed (for the builtin's errno-less StatWatcher) is **deleted**.
- `fs.watch` stays the fast-path edge, a pure pass-through to `emit` (never
  touches `observed`; a poll/edge double-fire is absorbed by the debounce+gate).
- teardown: `clearTimeout(pollTimer)` + `watcher.close()` behind the `closed`
  guard. No async stat to race.

This is the single-writer poll the design-gate lens run (wf_f8093c1f) already
approved before B1; the module doc's §"floor is a hand-rolled poll" carries the
`fs.watchFile`-REJECTED record so it is not re-attempted. (Also rejected earlier:
`@parcel/watcher`, `decayTransientState` re-arm.)

**Q1 kolu-io ✓** — the Q5 wiring creates the **first `kolu-shared → kolu-io`
workspace edge** (safe, leaf); **state it in the PR body**.
**Q2 name ✓, signature amended** — `intervalMs` is a **required** opts field (no
optional-default dead-knob); export `DEFAULT_APPEND_POLL_MS = 1000`, passed by
every production call site; **no fake timers** — tests inject a short real
interval (refcounted-dir-watcher.test.ts precedent).
**Q3 always-subscribed ✓ · Q4 1000ms ✓** (probe recovered a dropped edge in
903ms) **· Q5 one WAL seam ✓ · Q6 events.jsonl-only ✓** (record the signals.json
edge-only display-freshness residual in doc + PR body).

**Q7 — REVERSED: subscribe UNCONDITIONALLY** (file present or not) at all three
seams. The poll tolerates absence and fires on absent→present, so the first
stat that finds the file IS the appearance reconcile. Dir watches stay **fast
paths only**. Closes grok's never-re-arming macOS bootstrap hole, claude's
dropped-projectDir-edge window, and the WAL startup window in one mechanism.

**B2 — WAL:** keep the parent-dir inode-rearm (re-arms the fs.watch **edge** on a
new inode — a different failure class; and its unconditional `runRearm` kick
already covers the same-size checkpoint rewrite), but `armDirect`'s
null-signaling protocol **simplifies** — the path-following floor no longer needs
the WAL to pre-exist. Trace + state it.
**B3 — teardown test:** unit test extends to "no fire AND no reschedule when
unsubscribe races an in-flight tick".
**B4 — first-observation pinned:** the first stat that FINDS the file fires
`onChange` (the appearance reconcile); consumers' unconditional initial re-read
on attach still covers the attach-window. State as a contract rule.
**B5 — honest residual:** one module-doc paragraph — stat-sampling on
coarse-mtime filesystems retains a narrow alias window no key fully closes (probe:
SQLite rewinds the WAL to same-size same-inode after checkpoint); the edge path
is primary, the floor is a floor.

**Refuted (do not re-litigate):** issue fix-direction (2), `stop_reason`
reconcile — out of this PR's scope; its own recorded trigger is a future #1751
non-`end_turn` tail under ollama.
