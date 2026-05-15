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

## Baseline

| Run | Result | Failing scenarios | Notes |
| --- | ------ | ----------------- | ----- |
| _pending_ | | | |

## Optimization Log

| Cycle | Target | Classification | Change | Re-measure |
| ----- | ------ | -------------- | ------ | ---------- |
| _pending_ | | | | |

## Findings

_To be filled in at end of run._

## Dead Ends

_To be filled in at end of run._
