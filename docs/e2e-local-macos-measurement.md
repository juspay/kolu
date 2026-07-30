# Local macOS e2e measurement

Measured 2026-07-29 at commit `5ec6ad09` on an Apple M1 Max Mac with 10 CPU
cores and 64 GiB RAM. This report measures the local developer path, not the
dedicated CI host covered by `ci-e2e-macos-ralph-report.md`.

## Summary

- A real, default `just test-quick` run took **13m44s** wall-clock. Cucumber
  accounted for **12m33s**; the initial dependency setup and client build added
  about **1m12s**.
- The run executed **540 scenarios** at the default four workers. It failed 14
  scenarios and passed 526, so this is a timing of the current local experience,
  not a green-suite benchmark.
- **Code tab is the largest cluster:** 117 scenarios, 849.6 seconds of summed
  scenario work, and **29.9%** of all step execution time.
- Code tab is also independently flaky. Its first isolated run took **2m35s**
  and failed 1/117 scenarios. A second identical run entered an overload tail,
  reached at least nine failures, and was stopped after **15m26s** when the
  10-core machine's load average reached 84.
- Code tab is therefore a major culprit, but not the only one. In the full run,
  daemon/network tests produced 9/14 failures and agent integrations produced
  3/14. Their failures clustered around slow page loads, state propagation, and
  port discovery under load.

## Method

The baseline used the command developers actually run:

```sh
CUCUMBER_PARALLEL=4 /usr/bin/time -p just test-quick \
  --format message:/tmp/kolu-e2e-local-measure/full-1.ndjson
```

This includes `pnpm install`, the production client build, server startup, and
the Cucumber suite. Cucumber's message stream supplied per-scenario duration and
status. The isolated Code-tab repetitions reused the built client and ran:

```sh
CUCUMBER_PARALLEL=4 KOLU_SERVER="$PWD/scripts/kolu-source-wrapper.sh" \
  nix develop .#e2e --accept-flake-config -c bash -lc \
  'cd packages/tests && node --import tsx \
    ./node_modules/@cucumber/cucumber/bin/cucumber-js \
    --profile ui features/code-tab.feature'
```

"Scenario work" below is the sum of scenario step durations. It is intentionally
larger than wall-clock because four scenarios execute concurrently. It is the
best measure of how much workload each cluster contributes; it should not be
added to predict elapsed time without accounting for parallelism and the
slowest-worker tail.

## Baseline wall-clock

| Phase | Time | Share |
| --- | ---: | ---: |
| Install + Nix shell + client build | ~1m12s | 8.7% |
| Cucumber, four workers | 12m32.6s | 91.3% |
| **Total `just test-quick`** | **13m44.2s** | **100%** |

Cucumber reported 47m26.1s of summed step execution. The effective parallelism
was therefore about 3.78× during the Cucumber phase, close to the four-worker
ceiling despite the failures.

## Workload by cluster

The categories are based on feature ownership, not tags. They cover all 540
executed scenarios.

| Cluster | Scenarios | Scenario work | Work share | Failed |
| --- | ---: | ---: | ---: | ---: |
| Code tab | 117 | 14m09.6s | 29.9% | 2 |
| Daemon, session, and network | 44 | 10m12.9s | 21.5% | 9 |
| Agent integrations | 55 | 8m41.8s | 18.3% | 3 |
| Terminal I/O and lifecycle | 67 | 6m38.7s | 14.0% | 0 |
| Canvas, dock, and navigation | 124 | 2m23.3s | 5.0% | 0 |
| Code-adjacent browse/inspector | 38 | 2m11.6s | 4.6% | 0 |
| Mobile UI | 39 | 1m55.6s | 4.1% | 0 |
| Other product flows | 56 | 1m12.7s | 2.6% | 0 |

The headline is not merely that Code tab has many scenarios. Its average
scenario consumed 7.3 seconds of work, versus 1.2 seconds for the large
canvas/dock/navigation cluster.

### Slowest feature files

| Feature | Scenarios | Scenario work | Failed |
| --- | ---: | ---: | ---: |
| `code-tab.feature` | 117 | 14m09.6s | 2 |
| `ports.feature` | 7 | 8m23.5s | 7 |
| `grok.feature` | 6 | 7m28.6s | 3 |
| `scroll_lock.feature` | 10 | 5m45.9s | 0 |
| `file-ref-link.feature` | 16 | 1m41.2s | 0 |
| `mobile-soft-keyboard.feature` | 15 | 1m08.7s | 0 |
| `printed-url.feature` | 3 | 1m01.3s | 2 |
| `canvas.feature` | 47 | 1m00.6s | 0 |

`ports`, `grok`, and `printed-url` look expensive partly because failed waits
burned their full timeout budgets. That is real local cost, but not their clean
steady-state cost.

## Flakes by category

This is an observed-failure inventory, not a statistically stable flake rate.
One full run plus one completed and one aborted Code-tab repetition can identify
suspects, but cannot estimate probabilities precisely.

### Code tab

The full run failed two Markdown navigation scenarios during the initial
`page.goto`, both after 30 seconds:

- relative link to a missing path
- wikilink to the unique matching file

The first isolated Code-tab run failed a different scenario after a 60-second
wait:

- right-click "Open in All files" from a diff records history

The second isolated run was stopped after 15m26s. Before stopping it had failed
at least nine distinct scenarios spanning basic panel readiness, selection
persistence, context menus, binary/text detection, and Markdown footnotes. That
broad spread, combined with a load average of 84, points to cluster-wide resource
saturation or readiness loss rather than nine independent product defects.

### Daemon, session, and network

Nine failures appeared in the full run:

- all seven `ports.feature` scenarios failed
- two of three `printed-url.feature` scenarios failed

Failure modes were port-discovery waits expiring, the Ports section never
rendering, printed URLs remaining in the wrong join state, and later scenarios
timing out in `page.goto`. This category consumed 21.5% of suite work despite
having only 8.1% of scenarios because its failed waits burned 25–30 seconds at a
time.

### Agent integrations

Three of six Grok scenarios timed out while installing mocked `tool_use`,
`waiting`, and `awaiting_user` states. Each consumed the 70-second Cucumber step
budget. Claude Code and OpenCode scenarios did not fail in this run, so the
observed signal is Grok-specific, although shared filesystem-watch latency under
load remains a plausible common cause.

### Categories with no observed failures

Terminal I/O/lifecycle, canvas/dock/navigation, code-adjacent browse/inspector,
mobile UI, and the remaining product flows had no failures in the baseline.
This does not prove they are flake-free; it only means they did not fail in this
sample.

## What to optimize first

1. **Treat Code tab as an explicit heavy lane.** It is 30% of total work and can
   destabilize itself at four workers. Benchmark it at one and two workers after
   the host is idle, then give this cluster its own lower concurrency if that
   removes the overload tail. Do not infer a safe worker count from CPU count
   alone: each worker owns a browser, server, padi, kaval, Git repositories, and
   file watchers.
2. **Replace timeout-shaped readiness with causal readiness.** The expensive
   failures wait 25, 30, 60, or 70 seconds before saying that a page, history
   transition, port observation, or mocked agent state never became ready. Each
   path should wait on the event that makes it ready and fail immediately when
   its producer dies.
3. **Profile Code-tab setup.** Its 117 scenarios repeatedly create repositories,
   commit files, hydrate the right panel, and initialize syntax/preview
   machinery. Measure those steps individually. Reusable immutable fixture repos
   or a faster canonical repo builder could reduce cost without dropping
   coverage; mutable state must remain scenario-isolated.
4. **Keep network and agent clusters visible in reports.** They are smaller than
   Code tab by scenario count but accounted for 12/14 baseline failures and 40%
   of scenario work. A single aggregate e2e number hides this.
5. **Record host load with every benchmark.** The second Code-tab run proved
   that elapsed time becomes meaningless once the host saturates. Capture load,
   worker count, and whether the run was cold or warm alongside Cucumber's
   message output.

## Next measurement

On an otherwise idle Mac, run a small matrix with the built client reused:

| Cluster | Workers | Repetitions |
| --- | ---: | ---: |
| Code tab | 1, 2, 4 | 5 each |
| Daemon/network | 1, 2, 4 | 5 each |
| Agent integrations | 1, 2, 4 | 5 each |
| Rest of suite | 2, 4 | 3 each |

For every run, retain the message stream and report median wall-clock, p95
scenario duration, hard failures, and retried-but-passed scenarios. The current
measurements say where to focus; that matrix is what should choose the new local
worker policy.

## After: coverage-preserving Pareto migration

The first migration removes 24 executed scenarios whose input/state matrices
are already owned by canonical lower-level suites. The boundary ledger is in
`e2e-coverage-migration.md`.

Focused replacement suites: **237 tests passed**. Cucumber dry-run count:
**540 → 516 scenarios** (**−4.4%**).

### Like-for-like Code-tab result

Both runs reused the built client and ran only `code-tab.feature` at four
workers:

| | Before | After | Change |
| --- | ---: | ---: | ---: |
| Scenarios | 117 | 103 | −12.0% |
| Cucumber wall | 2m32.1s | 2m21.1s | **−7.2%** |
| Command wall | 2m35.3s | 2m23.4s | **−7.7%** |
| Summed step work | 9m40.8s | 8m56.2s | **−7.7%** |
| Failed | 1 | 0 | −1 |

The smaller runtime improvement than scenario-count reduction means the removed
Code-tab cases were cheaper than the retained filesystem, Git, iframe, and
multi-terminal boundary journeys. That is expected: coverage preservation keeps
the expensive boundaries.

### Changed-cluster result

Running Code tab, Grok, Ports, and scroll lock together after the migration:

- 116 scenarios
- 2m49.4s Cucumber / 2m51.5s command wall
- 9m45.0s summed step work
- 111 passed, 5 failed

All five failures were retained Ports boundaries whose section never rendered
within 25 seconds. Code tab, Grok, and scroll lock were green. The corresponding
four clusters contributed 35m47.6s of summed work in the full baseline; the
after run used 9m45.0s, but this **−72.8% is not a clean speedup claim** because
the baseline included nine Ports/Grok timeout failures and the after run was a
focused invocation. It does show that timeout tails, not ordinary passing
scenario bodies, dominate these clusters.

### Full-suite after attempt

A same-command full after run was attempted and rejected as a benchmark. The
host load reached 91 and, after 14 minutes, only about one quarter of scenarios
had started. It was stopped rather than comparing a saturated run with the
completed baseline. This reinforces the report's original conclusion: scenario
deduplication helps, but macOS host saturation and Ports readiness are separate,
higher-impact problems.
