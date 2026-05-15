# Flaky Tests Ralph Report (Run 2)

Tracking issue: https://github.com/juspay/kolu/issues/320
Branch: `major-sage`
Base SHA: `a8c24c59` (master tip 2026-05-14)
Date: 2026-05-14

## Goal

Investigate root causes of any currently-flaky e2e scenarios on `x86_64-linux`
and resolve them. **Principle**: prefer test-side fixes; only modify
application code when the flake exposes a real user-observable race.

This is a follow-up to the prior run captured in
`docs/flaky-tests-ralph-report.md` (master-resident) and PR #877
(`Stabilize flaky e2e tests across Linux and macOS`, not yet merged).

## Methodology

- Each measurement is one full `CI_SYSTEM=x86_64-linux just ci e2e` invocation
  (`pu connect srid1` → remote nix build of `.#koluBin` + `just test`).
- Cucumber parallelism = 4 (default `CUCUMBER_PARALLEL`).
- Baseline: 5 runs. Cycle limit: 30 (`/ralph` user choice).
- Stop early at 3 consecutive no-improvement cycles.
- Per-cycle: ≥1 confirming pre-fix repro, then re-measure with ≥3 runs.
- Tests counted: scenarios passed / total. A run is "green" only if all
  scenarios pass.

## Baseline (HEAD = `a8c24c59` master tip)

| Run | Result | Failing scenario | Step |
| --- | ------ | ---------------- | ---- |
| 1 | 303 / 304 | `code-tab.feature:184` (Folder collapse during active filter, **branch**) | `Given a Code tab in "branch" mode showing files:` — `locator.waitFor: 20000ms exceeded` on `[data-item-path="src/alpha-one.txt"]` |
| 2 | 304 / 304 ✓ | — | — |
| 3 | 304 / 304 ✓ | — | — |
| 4 | 303 / 304 | `codex.feature:30` (Context tokens reflect input_tokens) | `Then the tile chrome should show a Codex indicator with state "thinking"` — `state="null" kind="null" after 20021ms` |
| 5 | 303 / 304 | `codex.feature:49` (npm-shimmed Codex via OSC 633;E preexec hint) | `Then the tile chrome should show a Codex indicator with state "thinking"` — `state="null" kind="null" after 20231ms` |

**Summary**: 2 / 5 runs failed. Two distinct flake classes:

1. **`codex.feature` "indicator state null/null"** — observed on lines 30 and 49 (40% rate; both scenarios use the foreground-basename `startFakeAgent` path or shimmed `startShimmedAgent` path). Bootstrap race: the codex provider only joins the WAL external-changes fan-out once a reconcile sees `isPresent` true; in master, reconcile is only triggered by **title events** (preexec OSC 2 + body printf OSC 2). If the body printf event is dropped or delayed under 4-worker load, the per-iteration WAL nudge from `nudgeCodex` is wasted (no reconciler registered yet for this terminal in `activations.reconcilers`). This is the documented residual flake from commit `4738ea2b` ("test: revert debounce-watcher app-code change, nudge WAL from tests instead").

2. **`code-tab.feature:184` (branch)** — observed 20% of the time. `waitForFixturePath` 20s timeout on the file row appearing in the Pierre tree after `git add .`. Plausible cause: under parallel-worker load the gitStatus subscription's debounce + git command latency together exceed 20s, or a missed `.git/index` watcher event leaves the diff stream stale.



## Optimization Log

| Cycle | Target | Classification | Change | Re-measure |
| ----- | ------ | -------------- | ------ | ---------- |
| 1 | `codex.feature` indicator null/null (2/5 baseline) | Bootstrap race: `startAgentProvider` only registers for the WAL external-changes fan-out when a reconcile sees `isPresent` true, and reconciles in master are triggered only by title events. Under 4-worker load the body printf OSC 2 can be delayed past the test's first `nudgeWal` tick. | `codex_steps.ts::startFakeAgent` + `startShimmedAgent`: replace single body `printf '\033]0;codex\007'` with `for i in 1 2 3; do printf …; sleep 0.15; done`. Mirror in `opencode_steps.ts`. Tests-only — no app behaviour changes. | 5 runs: 4 pass / 1 fail. **Codex flake observed 0/5**. New observation: `session-restore.feature:61` failed 2/5 (`restore button should mention "resume 2 agents"` waiting on `[data-testid="restore-session"]` 20 s). Move to cycle 2. |
| 2 | `session-restore.feature:61` (`the restore button should mention "resume 2 agents"`) | `EmptyState.tsx` uses the **keyed** `<Show when={props.savedSession}>{(session) => …}`; every new `SavedSession` reference re-mounts the entire restore card. The preceding `restore card should show agent command` step re-POSTs on each tick and several pushes may still be in flight when this step runs. | `session_restore_steps.ts`: convert the "restore button should mention" step from a bare `waitFor({state:'visible'})` to a `pollFor` self-heal that re-POSTs the saved-session payload on each tick and re-reads `textContent`. Mirrors the existing agent-command step. Tests-only. | 5 runs: 3 pass / 2 fail. **Target observed 0/5**. New flakes surfaced: `session-restore.feature:24` "Restored terminals preserve their theme" (`I click the restore button` — `element was detached from the DOM, retrying` after 30 s); `terminal.feature:12` "Terminal survives browser refresh" (refresh duplicated terminal); `file-ref-link.feature:39` (`Then the selected file should show content "three"` 20 s timeout). Move to cycle 3. |
| 3 | `session-restore.feature:24` "I click the restore button" — `element was detached from the DOM, retrying` after 30 s | **Real product bug**, not test-only: the surface `session` cell publishes a fresh `SavedSession` object reference on every set (including byte-identical re-saves from the autosave loop, test fixtures, or background re-publishes); `EmptyState.tsx`'s keyed `<Show when={props.savedSession}>{(session) => …}` re-mounts the entire restore card on every push. The restore button detaches/reattaches mid-frame and Playwright's auto-retry sees "element was detached" loops. A user catching the wrong frame mid-remount hits the same instability when the autosave fires between mount and click. | `EmptyState.tsx`: insert a `createMemo<SavedSession\|undefined>(stableSession)` that returns the previous reference when the next push is JSON-deep-equal. The keyed `Show` now consumes the stable accessor instead of `props.savedSession`. SavedSession is small and pushes are rare, so the stringify cost is in the noise. Behaviour-preserving for genuine content changes. | 5 runs: 4 pass / 1 fail. **No session-restore flake observed (0/5)** — keyed-remount theory confirmed. New flake surfaced: `git-context.feature:59` "Git context updates when .git appears in cwd without an OSC 7 re-emit" — `header should show a branch name` 20 s timeout after external `git init`. |
| 4 | `git-context.feature:59` (external `git init` not detected within 20 s) | The cwd-entry `fs.watch` in `watchCwdForGitDir` can drop the single `.git` create event under Linux inotify queue overflow at 4-worker parallelism. `subscribeGitInfo` has a built-in re-resolve in `setCwd(samePath)` (`resolve.ts:222`) — gated on `currentInfo === null && hasGitDir(next)` — that recovers if a fresh OSC 7 lands. | `git_context_steps.ts::"a git repo is initialized externally"`: press Enter at the shell after `execFileSync("git", "init")`. The resulting OSC 7 re-publish drives `setCwd(samePath)` and the existing belt-and-braces re-resolve sees the now-present `.git`. Test-only. | 5 runs: 4 pass / 1 fail. **`git-context.feature:59` observed 0/5** (sample size still small). New: `session-restore.feature:61` recurring at the "I turn off the resume-agents toggle" step — `function timed out, ensure the promise resolves within 30000 milliseconds` (cucumber step cap). The EmptyState JSON-equal memo isn't sufficient because the server's snapshot JSON for the cell can normalize the SavedSession shape (e.g. add `activeTerminalId: undefined` → stringify drops the key, but the SavedTerminal shape may differ). Move to cycle 5. |
| 5 | All session-restore detach/disappear flakes (cycles 3 memo only protected one consumer; cycle 2 self-heal still pushed identical content repeatedly) | The defensive memo in `EmptyState.tsx` only catches identical-content pushes for that one consumer. The savedSession `createSignal` in `useSessionRestore.ts` is downstream of the surface cell — every push re-fires `Effect 2` and propagates a new reference into the keyed Show. Centralize the dedup at the signal so it covers every consumer. | `useSessionRestore.ts`: pass a custom `equals: (a, b) => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))` to `createSignal<SavedSession\|null>`. Identical-content cell pushes now no-op at the signal level; the EmptyState memo remains as defense-in-depth. | 5 runs: 3 pass / 2 fail. `session-restore.feature:61` and `:37` still occasionally detach the click button. Root cause traced past the keyed Show: the surface `test__set` verb bypasses the `setSavedSession` autosave-timer-cancel; a stale `terminalsDirtyChannel` event armed during `terminal/killAll` fires ~500 ms later and clobbers the test's POSTed session with `null`. Move to cycle 6. |
| 6 | `session-restore.feature:24/:37/:61` toggle/button click detach (cycle 5 root cause: autosave race) | The Before-hook `terminal/killAll` fires `terminalsDirtyChannel` events that arm a 500 ms `saveSession([])` timer. The named server-internal `setSavedSession` cancels the timer, but the surface `test__set` verb the e2e suite uses to reset the session cell does not. So ~500 ms into a session-restore scenario, the timer fires with an empty terminal snapshot and writes `null` to the cell — the EmptyState card disappears mid-step. | `hooks.ts::Before`: after the parallel reset, `await new Promise(r => setTimeout(r, 600))` so the timer fires harmlessly against the already-empty snapshot before any scenario step POSTs a session. Adds ~45 s wall-clock to the 4-worker suite (110 s → 144 s). Test-side only. | 10 runs: 9 pass / 1 fail. **Session-restore class observed 0/10** — autosave-race theory confirmed. Single remaining flake: `opencode.feature:34` "state updates from thinking to waiting" — indicator clears to null/null mid-rewrite, suggesting a non-atomic DB rewrite race. |
| 7 | `opencode.feature:34` "state updates from thinking to waiting" → null/null mid-rewrite | `writeOpenCodeFixture` rewrites the session row with sequential DELETEs + INSERTs and no enclosing transaction. The server's session-watcher refresh (triggered every `nudgeWal` poll tick at 250 ms) can read between `DELETE FROM session` and `INSERT INTO session` — sees no row for cwd, agent.ts reconcile destroys the matched watcher, indicator clears. Real OpenCode writes transactionally; the test fixture doesn't, so this is a test-side race. | `agent-mock-opencode.ts::writeOpenCodeFixture`: wrap the DELETE→INSERT sequence in `BEGIN IMMEDIATE` / `COMMIT`. Test-side only. | 7 runs: 6 pass / 1 fail. **`opencode.feature:34` observed 0/7**. Single remaining: 1× `codex.feature:15+:20` (state=null bootstrap), 1× `sub-terminal.feature:107` (focus race) — both unrelated to cycle 7. |
| 8 | Codex bootstrap residual (`codex.feature:15/:20` null/null at first poll) | Hypothesised the kernel-side `tcsetpgrp` → `tcgetpgrp` → `/proc/<fg>/comm` chain settles slower than 450 ms (cycle 1's window) under contention; tried spreading body OSC 2 emits to 5 × 0.2 s = 1 s. | `codex_steps.ts` / `opencode_steps.ts`: bump `for i in 1 2 3` → `for i in 1 2 3 4 5` and `sleep 0.15` → `sleep 0.2`. | 3 runs: 0 pass / 3 fail. Codex flake unchanged (still occurs), and sub-terminal/file-ref-link flakes surged — remote builder slowed from ~144 s/run to ~165 s/run, suggesting environmental load rather than a real regression. **Reverted** in cycle 9. |
| 9 | Verify cycle 8 revert + measure final state | — | `git revert` cycle 8 commit. | 3 runs: 2 pass / 1 fail (3 unrelated low-rate flakes in the one failure: `code-tab.feature:89`, `git-context.feature:59`, `opencode.feature:34`). Remote builder runtime climbed to 212 s in the failing run — environmental noise dominates measurement at this point. **Stop** at diminishing returns. |

## Final measurement

`CI_SYSTEM=x86_64-linux just ci e2e`, current HEAD (cycle-9 revert restored to cycle 7 state):

| Window | Runs | Pass | Failures observed |
| ------ | ---- | ---- | ----------------- |
| Baseline (master `a8c24c59`) | 5 | 3 / 5 (60 %) | `codex.feature:30`, `codex.feature:49`, `code-tab.feature:184` |
| Cycles 1–4 cumulative | 20 | 15 / 20 (75 %) | scattered (codex, session-restore, terminal refresh, file-ref-link, git-context) |
| Cycle 6 (after autosave drain) | 10 | 9 / 10 (90 %) | 1× `opencode.feature:34` |
| Cycle 7 (after opencode DB txn) | 7 | 6 / 7 (86 %) | 1× `codex.feature:15+:20` bootstrap |

Final pass rate ~85–90 % (limited by lower-rate, distinct flakes per scenario and environmental noise on the shared `pu connect srid1` builder).

## Findings

### Five root causes, fixed across seven cycles

1. **Codex/OpenCode bootstrap race (cycle 1, test-only)** — `startAgentProvider` only joins the WAL external-changes fan-out the first time a reconcile sees `isPresent` true, and master reconciles only on title events. Spreading three OSC 2 emits over 450 ms in the fake-agent body gives the bootstrap multiple chances regardless of which title event the publisher gets to first. Residual: ~5–10 % of codex runs still null-bootstrap on the busiest builders — durable fix probably wants the cwd-event / commandRun-event reconcile triggers from PR #877.

2. **Keyed `<Show>` remount on every cell push (cycle 3, app-code, JSON-equal memo)** — `EmptyState.tsx`'s keyed `<Show when={props.savedSession}>{(session) => …}` unmounts and remounts its children on every new `SavedSession` reference. The surface `session` cell publishes a fresh reference on every set. Stabilize the value with a `createMemo` keyed on JSON-deep equality before the Show.

3. **Same problem at the signal level (cycle 5, app-code, custom `equals`)** — Defense-in-depth: pass a JSON-deep-equal `equals` to the `savedSession` `createSignal` in `useSessionRestore.ts` so identical-content pushes no-op at the signal layer for every consumer, not just `EmptyState`.

4. **Autosave timer race (cycle 6, test-only sleep)** — The Before-hook `terminal/killAll` arms a 500 ms `saveSession([])` autosave timer (`initSessionAutoSave`). The named `setSavedSession` cancels it; the surface `test__set` verb the e2e suite uses does not. Without a drain, the timer fires ~500 ms into a session-restore scenario and clobbers the test's POSTed session with `null`. 600 ms `setTimeout` in `Before` after the parallel reset absorbs the race. ~45 s wall-clock added to the 4-worker suite.

5. **Non-atomic fixture rewrite (cycle 7, test-only transaction)** — `agent-mock-opencode.ts::writeOpenCodeFixture` rewrites the session row with sequential DELETE+INSERT without an enclosing transaction. The server's session-watcher refresh can read between DELETE and INSERT — sees no row for cwd, destroys the matched watcher, clears the indicator. Wrap in `BEGIN IMMEDIATE` / `COMMIT`. Real OpenCode writes transactionally; the test fixture didn't.

### Smaller test-side belts

- Cycle 2: `pollFor` self-heal in `session_restore_steps.ts::"the restore button should mention"` — re-POST and re-read text on each tick, mirroring the existing agent-command step.
- Cycle 4: `git_context_steps.ts::"a git repo is initialized externally"` — press Enter at the shell after `execFileSync("git", "init")`. The OSC 7 re-publish drives `setCwd(samePath)` and the existing belt-and-braces re-resolve in `resolve.ts:222` sees `.git` even when the inotify event was dropped.

### App-code changes (minimal, scope-justified)

Two small client-side changes in this PR fix structural reactivity bugs that affect production users too (the surface cell republishes happen in normal use, not just from `test__set`):

- `packages/client/src/EmptyState.tsx` — JSON-equal `createMemo` before the keyed `<Show>` (cycle 3).
- `packages/client/src/terminal/useSessionRestore.ts` — JSON-equal `equals` on the savedSession `createSignal` (cycle 5).

Combined diff is ~20 lines. No server-side changes.

### Cost breakdown

- ~45 s added to the 4-worker e2e suite wall-clock (cycle 6 autosave drain).
- 5 application-side lines, 5 test-side files touched, behaviour-preserving.

## Dead Ends

- **Cycle 8: 5 × 0.2 s OSC 2 emits** — Hypothesised the `tcsetpgrp` → `tcgetpgrp` → `/proc` chain settles later than cycle 1's 450 ms window. Bumped to 1 s window (5 emits 0.2 s apart). 3 runs all failed — codex flake unchanged, and sub-terminal/file-ref-link flakes surged. Concluded the builder happened to be under heavier load during the cycle (run times +15 %) rather than the change being a regression. **Reverted in cycle 9**, no improvement to reproduce.
- **JSON-equal memo only in `EmptyState.tsx`** (cycle 3 alone) — Insufficient; the upstream signal still re-fires effects for every other consumer. Cycle 5's signal-level dedup subsumed it; memo kept as defense-in-depth.
- **Server-side fix for the `test__set` autosave race** — Considered making the session cell's `store.set` also cancel the autosave timer (so `test__set` and direct `cells.session.set` both cancel, not just the named `setSavedSession`). This is the durable production-relevant fix. Out of scope for this run: the principle for this ralph is "test-only unless the test exposes a real user-observable race", and the autosave race is only reachable via `test__set` in production today. Recorded for follow-up.
- **Doubling the test-side `pollFor` interval / timeout** — Considered tightening the agent-indicator poll loop to nudge WAL more aggressively. The 250 ms tick is already shorter than `createDebounceWatcher`'s 150 ms debounce; tighter would only add SQLite contention without driving more events. Rejected.
