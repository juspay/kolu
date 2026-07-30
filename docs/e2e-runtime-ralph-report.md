# E2E runtime optimization report

## Goal

Reduce Kolu's browser E2E load without losing coverage of any user-visible
feature. A scenario is retired only after a lower-layer test proves the same
defect surface and an independent browser scenario still walks the user path.

## Method

- The immutable starting census is 58 feature files, 530 scenario declarations,
  and 546 expanded executions (541 in default Linux CI and 540 on Darwin).
- Runtime comparisons use alternating before/after runs on the same leased host,
  with at least five samples per arm and platform.
- Reports use medians and interquartile ranges. A time change below 3% is noise.
- The measured signals are E2E, unit, daemon, and whole-pipeline critical-path
  wall time, plus execution attempts and retries.
- Coverage is checked independently from speed through the append-only scenario
  inventory, retirement ledger, collected replacement tests, counterfactual
  proofs, and retained browser journeys.

## Measurements

| Stage | Linux E2E | Darwin E2E | Linux critical path | Darwin critical path | Executions |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | collecting | collecting | collecting | collecting | 541 / 540 |
| Final | pending | pending | pending | pending | pending |

## Optimization log

| Cycle | Target | Result | Decision |
| ---: | --- | --- | --- |
| 0 | Install immutable inventory, retirement ledger, and attempt timing | The current 58 / 530 / 546 census is mechanically reproduced; no E2E retired | Keep |

## Findings

The retirement ceiling is not a quota. Every candidate is decided from coverage
and paired runtime evidence; rejected candidates remain browser tests and are
recorded as final KEEP decisions rather than deferred work.
