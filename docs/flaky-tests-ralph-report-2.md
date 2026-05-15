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

## Findings

_To be filled in at end of run._

## Dead Ends

_To be filled in at end of run._
