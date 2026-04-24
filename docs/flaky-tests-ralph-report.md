# Flaky Tests Ralph Report

Issue: https://github.com/juspay/kolu/issues/320

## Methodology

Target metric: failures across repeated runs of known flaky test classes.

Baseline commands:

```sh
for i in 1 2 3 4 5; do
  nix develop . --accept-flake-config -c pnpm --filter kolu-server test:unit
done

for i in 1 2 3 4 5; do
  CUCUMBER_PARALLEL=4 just test-quick \
    features/code-tab.feature \
    features/osc52-clipboard.feature \
    features/session-restore.feature \
    features/canvas.feature
done
```

## Baseline

| Target                   | Runs | Result             |
| ------------------------ | ---: | ------------------ |
| `kolu-server` unit tests |    5 | 5 passed, 0 failed |
| Focused e2e flaky set    |    5 | 5 passed, 0 failed |

The local Linux baseline did not reproduce the flakes. The mutation targets are therefore based on the repeated CI evidence in issue #320: darwin clipboard bleed, Code tab git-status waits, Before-hook socket resets, canvas wheel ownership timing, terminal readiness under darwin load, and the server unit shared-state race.

## Optimization Log

| Cycle | Target                 | Classification            | Change                                                                                                            | Measurement            |
| ----- | ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1     | Harness setup          | transient connection race | Retry transient setup POST/page creation failures and preserve the root Before-hook error by guarding screenshots | 5/5 focused e2e passed |
| 1     | E2E waits              | slow CI propagation       | Raise shared ready/poll budgets from 10s to 20s                                                                   | 5/5 focused e2e passed |
| 1     | Clipboard tests        | shared external state     | Clear clipboard on app load to prevent cross-scenario bleed                                                       | 5/5 focused e2e passed |
| 1     | Code tab               | stale/late git state      | Poll changed-file assertions and refresh the Code tab while waiting                                               | 5/5 focused e2e passed |
| 1     | Canvas wheel ownership | step-boundary timing      | Wait for canvas/xterm and dispatch the ownership claim plus terminal wheel in one browser turn                    | 5/5 focused e2e passed |
| 1     | Server unit tests      | shared state file         | Disable Vitest file parallelism for the server package                                                            | 5/5 server unit passed |

## Re-measure

Same commands as baseline, after the cycle-1 hardening changes:

| Target                   | Runs | Result             |
| ------------------------ | ---: | ------------------ |
| `kolu-server` unit tests |    5 | 5 passed, 0 failed |
| Focused e2e flaky set    |    5 | 5 passed, 0 failed |

Local pass rate stayed at 100%, so this loop cannot claim a local failure-rate delta. The useful signal is the issue-log classification: each change removes or narrows a concrete race that has appeared in CI.

## Findings

- `ci/home-manager@x86_64-linux`'s `curl` readiness race was already fixed in this checkout by polling the HTTP listener.
- The server unit flake has a small suite-level cost to eliminate: `kolu-server` now runs Vitest files serially, avoiding concurrent `Conf` reads/writes against one `KOLU_STATE_DIR`.
- Several e2e failures were not product failures; they were harness races around setup, external clipboard state, and step-boundary timing.
- The broad timeout increase is intentionally limited to test helpers. Cucumber's 30s step timeout remains the upper bound.
