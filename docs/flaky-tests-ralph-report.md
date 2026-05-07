# Flaky Tests Ralph Report

Issue: https://github.com/juspay/kolu/issues/320
Branch: `ralph-flaky-tests`
PR: https://github.com/juspay/kolu/pull/838
Date: 2026-05-07

## Goal

Address root causes of currently-flaky tests on master (commit `380abffc`).

This run did **not** trust the issue's older comments — many of those have been fixed since. Measured first, fixed only what currently fails.

## Methodology

- `just test-quick` (full feature suite, 269 scenarios, `CUCUMBER_PARALLEL=4`).
- Measured pre-fix (3 runs) and post-fix (5 runs) on the same hardware.
- One fix per cycle; commit only when the next round of measurements either resolves the failing scenario or stays green.

## Baseline (HEAD = `380abffc`)

| Run | Pass / Fail | Failing scenario | Step |
| --- | ----------- | ---------------- | ---- |
| 1 | 268 / 269 | `code-tab.feature:276` | `When I click the line number 1 in the diff view` (after switch to file-b) — `Error: line gutter has no bounding box` |
| 2 | 268 / 269 | `code-tab.feature:276` | same step |
| 3 | 268 / 269 | `code-tab.feature:276` | same step (this time on file-a's first click) |

3/3 baseline runs hit the same scenario. Deterministic under local conditions.

## Optimization Log

| Cycle | Target | Classification | Change | Re-measure |
| ----- | ------ | -------------- | ------ | ---------- |
| 1 | `clickLineGutterIn` (`code_tab_steps.ts`) | TOCTOU between Playwright `waitFor(visible)` and `boundingBox()` while Pierre `VirtualizedFileDiff` re-mounts (FileDiff is keyed on path, virtualizer re-measures on switch) | Poll `boundingBox()` until it returns a non-null, non-zero rect (POLL_TIMEOUT budget) | post1: `code-tab.feature:276` PASSED ✓; new flake `codex.feature:39` "Context tokens do not double-count" surfaced (state stuck at null/null at 20s) — same scenario in isolation: 5/5 PASS, so parallel-load-only |
| 2 | `createDebounceWatcher` (`packages/shared/src/sqlite/debounce-watcher.ts`) | `fs.watch` events dropped under inotify-queue overflow with 4 cucumber workers each running their own server + WAL watcher; codex/opencode session-watchers wedge on stale state | Add a 2 s polling fallback (skipped while debounce timer is armed; equality gate prevents no-op dispatches). Single-line server change, broadest reach (codex + opencode both use this factory) | post4: `codex.feature:39` PASSED ✓; new flake `session-restore.feature:61` "Restore card surfaces agent commands behind a global resume toggle" surfaced |
| 3 | `the restore card should show agent command` step (`session_restore_steps.ts`) | Same hydration race as the existing self-heal in "session restore card should be visible" — the once-only `hydrated` flag in `useSessionRestore` can latch on a snapshot that doesn't yet reflect the most-recent `lastAgentCommand` POST | Re-POST the saved-session payload on each poll iteration (matches the visibility step's pattern); drives a `serverState.savedSession()` change which re-fires the recovery `createEffect` | post5–post9: 5 consecutive clean runs, **269/269 each** |

## Re-measure (HEAD = post-cycle-3 commit `62bb85ab`)

| Run | Result |
| --- | ------ |
| post5 | 269 / 269 ✓ |
| post6 | 269 / 269 ✓ |
| post7 | 269 / 269 ✓ |
| post8 | 269 / 269 ✓ |
| post9 | 269 / 269 ✓ |

5 consecutive clean runs at the same parallelism (`CUCUMBER_PARALLEL=4`). Scenario count went from 268/269 deterministic-fail and intermittent codex/session-restore to 269/269 reliably.

## Findings

### Three distinct root causes, three different layers

1. **Pierre virtualizer remount window** (`code-tab.feature:276`) — Playwright's `waitFor({state:"visible"})` can resolve while the next call returns null `boundingBox()`, because the virtualizer re-measures between the two calls. Polling the box until stable is a one-line, harness-side fix.
2. **Inotify queue overflow** (`codex.feature:39`, latent for opencode) — The shared SQLite WAL watcher relied entirely on `fs.watch`. Under 4-worker load the kernel queue overflowed and dropped events. Added a 2 s polling fallback in the shared `createDebounceWatcher`. Production benefit too: real users on busy machines are subject to the same overflow.
3. **Once-only client hydration race** (`session-restore.feature:61`) — `useSessionRestore`'s `hydrated` flag latches the first non-pending snapshot. When the test posts the saved session multiple times in quick succession (set terminals, then add `lastAgentCommand` for terminal 0, then for terminal 1), the snapshot used for hydration may pre-date the latest POST. The companion `createEffect` recovers when `serverState.savedSession()` changes — so re-POSTing on each poll iteration drives the recovery deterministically.

### Cost breakdown

- **`createDebounceWatcher` polling fallback**: one cheap `refresh` (stat + small SQL read) every 2 s per active session-watcher. Equality gate suppresses no-op dispatches. Cost is negligible vs the inotify-overflow class of bugs it eliminates.
- **Test-side polling self-heals** (line gutter, session-restore card): same 20 s budget as the assertions they replaced. No timeout extension; just denser checks within the same window.

### Dead ends investigated

- **Test-side WAL nudging in codex_steps**. Considered re-bumping the SQLite DB on each poll iteration (mirroring claude-code's `nudgeMockFiles`). Rejected: the `createDebounceWatcher` polling fallback is the correct level of abstraction (server-side, helps production too, single point of fix for codex + opencode).
- **Server-side polling in `startAgentProvider`** for the title/external-event paths. Investigated; not needed because the title-event path already had stability belts in place (double OSC 2 in `startFakeAgent`/`startShimmedAgent`), and post-cycle 2 fixed the WAL-event path.

### What was not changed

- The harness retry/timeout primitives in `hooks.ts`. The `After` hook already guards `this.page` (line 417), addressing the cascade described in older comments.
- `home-manager` NixOS VM `curl` race. Not reproducible locally; relevant fix path was already documented in-issue.
- Darwin-specific clipboard bleed, canvas wheel-ownership flakes. Not reproducible on Linux; left for a darwin-targeted ralph run.
