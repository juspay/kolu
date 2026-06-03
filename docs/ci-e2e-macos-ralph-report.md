# CI e2e macOS (rasam) ralph report

Measurement-driven optimization of the **`e2e` CI recipe on the `aarch64-darwin`
lane**, which runs on the `rasam` host (Apple Silicon `T6020`, 24 cores, 128 GB,
macOS 15.5). Two goals, Pareto-balanced (a change must not worsen the other
axis):

1. **Total e2e-lane wall-clock** — shorten it.
2. **Flakiness** — drive the residual darwin flake rate toward zero.

User-set constraints for this run:

- **No coverage reduction** — cannot win by `@skip`/`@skip-darwin`-ing or
  deleting scenarios; the same behaviors must be exercised at the end.
- **App behaviour-preserving** — any app-code change (not just test harness)
  must preserve observable behaviour.
- **Land in the real `ci::e2e`** — changes take effect in the actual darwin CI
  recipe; the `justci`-measured number is the deliverable.
- **Parallelism & retry budget are in scope** — `CUCUMBER_PARALLEL` and
  `CUCUMBER_RETRY` are tunable levers (the host has 24 idle cores; CI uses 4
  workers).

---

## What the e2e lane does

The `e2e` node (`ci/mod.just`) depends on the shared `install` node and runs:

```
install:  pnpm install --frozen-lockfile           # shared workspace deps
e2e:      CUCUMBER_RETRY=1 nix develop -c just test
```

`just test` (`justfile`) then:

1. `nix build .#koluBin` — the server+client binary (content-addressed; cached
   across runs unless app source changes — test-harness edits don't rebuild it).
2. `cd packages/tests && pnpm install` — the tests workspace.
3. `nix develop .#e2e -c pnpm test` — Cucumber, `CUCUMBER_PARALLEL=4`,
   `CUCUMBER_RETRY=1`, 43 feature files (~280+ scenarios).

The `.#e2e` devshell adds the Playwright browsers (`PLAYWRIGHT_BROWSERS_PATH`).

## Methodology

- **Harness**: a persistent git-snapshotted checkout on rasam under
  `~/ralph-e2e/kolu`; `ralph-measure.sh` mirrors the `just test` e2e node exactly
  (build `koluBin` → tests `pnpm install` → cucumber under `.#e2e`) and adds only
  a `--format message:…ndjson` sink (behaviour-neutral) for per-scenario
  pass/fail/retry/duration. `ralph-parse.mjs` reduces that ndjson to a verdict.
- **Serial**: rasam is one host — runs are strictly sequential so CPU contention
  doesn't corrupt the flakiness signal.
- **Duration** = the three timed phases (`build_s` + `install_s` + `cuke_s`);
  `koluBin` is hot (cached) for the steady-state CI number, cold measured once.
- **Flakiness** = pass/fail + retried-but-passed per scenario across N runs.
- **Noise floor**: time deltas < 3% are not commits, documented only.
- **Authoritative number**: a real `justci run e2e@aarch64-darwin` at the end.

---

## Baseline (HEAD = `<pending>`)

_Measuring — 5 serial runs at the current CI settings (PAR=4, RETRY=1)._

| Run | build_s | install_s | cuke_s | total_s | pass/total | retried | failed |
| --- | ------- | --------- | ------ | ------- | ---------- | ------- | ------ |
| _pending_ | | | | | | | |

Cold `koluBin`: _pending_. Hot steady-state median: _pending_.

---

## Optimization log

| Cycle | Axis | Target | Classification | Change | Re-measure | Verdict |
| ----- | ---- | ------ | -------------- | ------ | ---------- | ------- |
| _pending_ | | | | | | |

---

## Dead ends

_Documented as encountered ("X doesn't help")._

---

## Findings

_Pending._

---

## Cost breakdown

_Pending._
