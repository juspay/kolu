# Flaky E2E Tests Ralph Report

Date: 2026-05-13
Branch: `ralph-flaky-e2e-2026-05-13`
PR: https://github.com/juspay/kolu/pull/877

## Goal

Improve the reliability of Kolu's Cucumber/Playwright e2e suite on both the
local Linux development machine and the `sincereintent` macOS machine.

Primary metric: repeated `just ci e2e` success rate. A run is green only when
the packaged `just test` e2e step passes through the CI wrapper on the target
platform.

Secondary metric: failure clustering by feature, scenario, step, and platform.
The loop targets the dominant observed failure mode first instead of guessing
from old flakes.

## Methodology

- Linux command: `CI_SYSTEM=x86_64-linux just ci e2e`
- macOS command: `CI_SYSTEM=aarch64-darwin just ci e2e`
- Baseline: 5 full-suite runs per platform where practical.
- Re-measure: the same command and parallelism after each targeted change.
- Commit policy: one targeted change per cycle; commit only changes that remove
  an observed failure class or clearly improve stability beyond noise.

## Baseline (HEAD = `cec13ae`)

| Run | Platform | Result | Failure |
| --- | -------- | ------ | ------- |
| baseline-1 | `x86_64-linux` | 295 / 295 passed | none |
| baseline-1 | `aarch64-darwin` (`sincereintent`) | 294 / 295 passed | `keyboard-shortcuts.feature:39` timed out after `When I press the prev terminal shortcut`; the active terminal never showed `cycle-second` |

The first paired baseline was enough to expose a platform-specific failure:
Linux accepted the positional terminal-cycle chord, while macOS Chrome did not
reliably deliver the same `Cmd+Shift+[` input to the app.

## Optimization Log

| Cycle | Platform | Target | Classification | Change | Re-measure |
| ----- | -------- | ------ | -------------- | ------ | ---------- |
| 1 | macOS primary, Linux regression guard | `nextTerminal` / `prevTerminal` shortcut registration and e2e step | Browser-reserved platform chord: `Cmd+Shift+[` / `Cmd+Shift+]` overlaps macOS Chrome tab navigation, so it is not reliable app input | Move next/previous terminal to physical `Ctrl+Shift+[` / `Ctrl+Shift+]` in the action registry and make the e2e step press that same physical chord | pending |

## Final Measurement

Pending.

## Findings

- `just ci e2e` runs 295 non-`@skip` Cucumber scenarios through the packaged
  `just test` path.
- The first observed failure is not a generic timing problem. It is a shortcut
  ownership problem: app-level terminal cycling used the platform modifier, but
  macOS Chrome already owns `Cmd+Shift+[` / `Cmd+Shift+]` for tab navigation.

## Dead Ends

Pending.
