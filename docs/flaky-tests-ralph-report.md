# Flaky Tests Ralph Report

Issue: https://github.com/juspay/kolu/issues/320
Branch: `ralph-flaky-tests`
Date: 2026-05-07

## Goal

Address root causes of currently-flaky tests on master (commit `380abffc`).

This run intentionally does NOT trust the issue's older comments — many fixes have shipped since (server unit serialization, harness retries, per-worker dirs, code-tab polling). We measure first, then act.

## Methodology

1. Run `just test-quick` (full feature suite) 5× with default `CUCUMBER_PARALLEL=4`.
2. Run `pnpm --filter kolu-server test:unit` 5× with default Vitest parallelism.
3. Identify scenarios that fail in any run. Classify by root cause.
4. Pick the biggest contributor, fix, re-measure.

## Baseline (HEAD = `380abffc`)

To be filled.

## Optimization Log

| Cycle | Target | Classification | Change | Re-measure |
| ----- | ------ | -------------- | ------ | ---------- |

## Findings

(Filled in at end of run.)
