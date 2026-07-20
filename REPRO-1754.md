# Reproduction — #1754 (fast-turn stranded `thinking`)

**Report token:** RT-1754-D4TA
**Branch:** `repro/1754-fast-turn-state`
**Host:** linux 7.0.5, Node v24.14.1
**Scope:** reproduction only — no fix code, no fix-design decisions.

## TL;DR

Half 2 of #1754 (**append-after-attach, coalesced/missed re-read**) reproduces
**deterministically** against the **real** grok and claude-code session
watchers. Both watchers are *purely edge-triggered* off `fs.watch`: when the
terminal completion append (`turn_ended` / `stop_reason:"end_turn"`) lands after
the watcher has attached, and the OS drops or coalesces that one `fs.watch`
notification, **nothing ever re-reads the file** and the live-state strands on
`thinking` forever. The file on disk is correct; only the notification is
missing — so this is Half 2, not Half 1.

Two committed, runnable repros drive the actual watcher modules and prove it.
An empirical probe of real Linux `fs.watch` (0/300 stranded) confirms the
issue's own note that **Linux inotify is the reliable lane** — which is exactly
why the deterministic model (the `fs.watch` non-guarantee macOS kqueue exhibits)
is the faithful and preferred repro, per the brief.

## Artifacts (all on this branch, under `repro-1754/`)

| File | What it is |
|---|---|
| `repro-1754/fswatch-shim.ts` | A controllable `fs.watch` replacement. Every other fs call hits the REAL filesystem; only the *notification* is under test control, modeling `fs.watch`'s documented "events may be missing / coalesced" non-guarantee. |
| `repro-1754/grok-half2.test.ts` | Drives the real `createGrokWatcher`. Fast turn → dropped terminal edge → asserts stranded `thinking`; then delivers one edge → same bytes flip to `waiting`. |
| `repro-1754/claude-half2.test.ts` | Same, driving the real `createSessionWatcher` (claude-code). |
| `repro-1754/linux-fswatch-probe.mjs` | Plain-node characterization of real inotify+`fs.watch` on this host under a fast-turn write pattern. |

### How to run

```
# deterministic repros (drive the real watchers) — both PASS (bug reproduced)
nix develop . --accept-flake-config -c node_modules/.bin/vitest run repro-1754/

# empirical inotify characterization on this host
node repro-1754/linux-fswatch-probe.mjs 300 12
```

Observed:

```
 Test Files  2 passed (2)
      Tests  2 passed (2)

stranded 'thinking' (terminal edge missed): 0/300 (0.0%)
trials where NO edge ever fired for the append: 0/300
```

(The vitest repros are deliberately GREEN: each asserts the *current* stranded
behavior, so they document the defect without breaking any package's test run.
They live outside every package's test glob — `pnpm -r test:unit` never picks
them up. When the fix lands, the "stays `thinking`" assertions invert to
"reconciles to `waiting`".)

## The mechanism (verified in code, not just the issue text)

Both watchers share one shape: `fs.watch(path, cb)` → a 150 ms trailing-edge
debounce → re-read a large tail → re-derive state. There is **no
level-triggered poll / re-stat**. The state only ever advances when an
`fs.watch` edge fires.

- **grok** — `packages/integrations/grok/src/session-watcher.ts`. `schedule()`
  arms a 150 ms `setTimeout` that calls `emitIfChanged()`. That timer is the
  *only* thing that re-derives, and it is armed **only** from an `fs.watch`
  callback. No fallback timer of any kind. A dropped terminal edge = permanent
  strand. State table (`core.ts`): `turn_started` → `thinking`, `turn_ended`
  → `waiting`.

- **claude-code** — `packages/integrations/claude-code/src/session-watcher.ts`.
  Same `fs.watch` + 150 ms debounce (`scheduleTranscriptCheck`). It *does* have
  a fallback one-shot (`scheduleStaleRecheck` driving `decayTransientState`,
  `core.ts:~1254`) — **but it is deliberately disarmed for a live `thinking`.**
  A trailing `user` prompt that postdates the running claude's `startedAt` is
  "not orphaned", and `decayTransientState` returns `{ recheckAt: null }` with
  the comment *"this is a live turn, never cleared"*. A fast real turn produces
  exactly that shape (a fresh live prompt), so the one fallback that could
  rescue the state does not arm. `deriveState` (`core.ts:~500`) maps
  `assistant + stop_reason:"end_turn"` → `waiting`; the trailing live `user`
  prompt before that append → `thinking`.

So on the fast-turn shape, **neither** watcher has any mechanism that re-reads
the file after a dropped terminal edge.

## Observed vs expected

| | Expected | Observed (both watchers) |
|---|---|---|
| Attach during open turn | `thinking` | `thinking` ✓ |
| Terminal completion appends after attach | re-read → `waiting` | edge dropped → **no re-read** |
| After the turn is over and the file is quiet | reconciles to `waiting` | **stranded `thinking` indefinitely** |
| One later edge delivered (control) | `waiting` | `waiting` ✓ (proves the bytes were correct all along) |

## Which half(s) reproduced

- **Half 2 (append-after-attach, coalesced/missed re-read): REPRODUCED**,
  deterministically, on both grok and claude-code, against the real watchers.
  This is the half the brief flags as the actual flake.
- **Half 1 (attach-after-write, tail-only read): NOT the defect** — confirmed by
  the control step. When a single edge is finally delivered, the watcher's own
  large-tail read (grok 128 KB, claude 256 KB `TAIL_BYTES`) derives `waiting`
  from the fully-written file. Half 1 is already handled; the repro isolates
  that by reading the *same on-disk bytes* and getting the correct answer the
  moment a read is triggered.

## Timings

- Watcher debounce: **150 ms** (`TRANSCRIPT_DEBOUNCE_MS` / grok `DEBOUNCE_MS`).
- Repro quiet window after the dropped terminal append: **500–600 ms** — well
  past the debounce; the state never moves.
- claude stale-recheck window (`TRANSIENT_STALE_MS`): **2 minutes** — and it is
  never even armed for a live `thinking`, so it does not bound the strand.
- Real fast turns per the issue's evidence: codex **~0.9–1.2 s**
  (924 ms / 1.17 s measured), the window inside which `task_started` then
  `task_complete` both land after attach.

## Why the Linux end-to-end probe reads 0%

`fs.watch` on this Linux box uses inotify, which reliably delivers an
`IN_MODIFY` for a single append to an idle watcher — so a lone terminal append
is not dropped, and the fast-turn end-to-end path does **not** flake here (0/300).
This matches the issue verbatim: *"reliable on the slow x86_64-linux CPU lane"*
and *"macOS `fs.watch` (kqueue) especially coalesces/misses the append"*. The
defect is an **architectural** gap (no level-triggered fallback), not a
Linux-inotify timing bug; Linux inotify happens to paper over it statistically
while kqueue exposes it. Hence the deterministic model — which injects the
dropped edge the OS is *permitted* to produce — is the faithful reproduction the
brief prefers, rather than a flaky statistical Linux run.

## What a fix must defeat (constraints only — no design)

A fix has to make the terminal state reconcile **even when no further
`fs.watch` edge ever arrives after the completion append**. Concretely, it must
survive all of:

1. **A single dropped/coalesced terminal edge** with **no subsequent write** —
   the turn is over and the agent is idle, so nothing else will ever nudge the
   watcher. (This is the exact condition both repros encode.)
2. **A live (non-orphaned) `thinking`** — claude's existing stale-recheck is
   disarmed for this shape by design, so a fix cannot lean on the current
   orphaned-prompt decay path.
3. **Grok having no fallback timer at all** — the fix must add the recovery, not
   reuse an existing one.
4. **The shared class across providers** — grok (`events.jsonl`), claude
   (transcript JSONL), and per the issue codex (`state_*.sqlite` WAL) all have
   the same edge-triggered-only shape; a fix should defeat the class, not one
   file format.

It must do this **without** re-introducing the churn the 150 ms debounce exists
to suppress (claude streams tokens; a naive tight poll re-allocates the 256 KB
tail and re-fires summary fetches hundreds of times/sec) and without a
degradation/override knob (repo fail-fast convention).

## Notes on fidelity

- The repros import and run the **actual** `createGrokWatcher` /
  `createSessionWatcher` — the real `deriveGrokInfo` / `deriveState`, the real
  tail readers, the real debounce and (for claude) the real
  `decayTransientState` path. Only `fs.watch`'s *notification* is intercepted;
  the state is derived from real bytes on a real temp filesystem.
- The dropped edge is not a contrived "we just didn't call the callback" — it is
  the documented `fs.watch` contract (Node: not 100% consistent, events may be
  missing), which the empirical section shows kqueue realizes and inotify (this
  run) did not. The control step (deliver one edge → correct answer) proves the
  strand is caused solely by the missing notification, nothing else.
- No production kolu, no `kolu.service`, no other worktree or terminal was
  touched. Deps were installed into this worktree only (`just install`). No
  model server or long-lived process was spawned; the vitest/probe runs are
  short-lived and self-cleaning.
