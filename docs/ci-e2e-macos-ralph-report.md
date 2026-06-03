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

## Baseline (HEAD = `a1407591`, PAR=4, RETRY=1)

Hot store (steady-state CI condition: `koluBin` + deps + browsers cached).

| Run | build_s | install_s | cuke_s | total_s | pass/total | failed |
| --- | ------- | --------- | ------ | ------- | ---------- | ------ |
| warm0 (cold) | ~200 | ~10 | ~360 | ~563 | 398/398 | 0 |
| b1 | 1 | 1 | 450 | **452** | 397/398 | 1 |
| b2 | 0 | 2 | 570 | 572 | 398/398 | 0 |
| b3 | 0 | 2 | 418 | **420** | 397/398 | 1 |

**Baseline median total ≈ 452s (7.5 min)** at PAR=4. High run-to-run variance
(420–572s). Flakiness: 2 of 3 runs hard-failed one scenario (code-tab
branch-filter) — the same flake b1 surfaced; see Cycle "code-tab barrier".

**Key baseline facts:**

- **The cucumber suite IS the cost.** `build_s`/`install_s` are ~1s each on the
  warm rasam store — `koluBin` is cached (test-harness edits don't rebuild it)
  and pnpm deps are already present. So the "triple pnpm install" overhead the
  static profile flagged is **sub-noise on a warm store** (the realistic
  steady-state for this long-lived host); its duration win is < 3%. Documented as
  a near-dead-end for duration (its flakiness benefit — closing the concurrent
  `pnpm` corruption window — still stands but is rare).
- **`cuke_s ≈ 450s` (7.5 min) at PAR=4** is the number to beat. The suite is the
  long pole; **parallelism is the lever** (host is idle 24-core).
- **Flakiness is real at PAR=4**: b1 hard-failed (both attempts)
  `code-tab.feature` "Filter survives clicking a filtered result [branch]".
- **Slowest scenarios** (b1, final-attempt seconds): mobile-soft-keyboard
  "does-not-summon-keyboard" ~34s & ~33s, file-ref-link touch ~33s,
  mobile-dock-drawer ~31s, code-tab in-iframe-edit ~26s. These are heavy by
  nature (mobile viewport + scrollback render + hydration), not a cheap cut; they
  set the per-worker tail that bounds wall-clock at high parallelism.

---

## The parallelism wall (key discovery)

CI runs `CUCUMBER_PARALLEL=4`; rasam has 24 idle cores, so the static profile's
top candidate was "raise workers → ~halve the suite." A 4/6/8/12 sweep (3 runs
each) showed this is **not** a free win:

| PAR | total_s (3 runs) | failed (3 runs) |
| --- | ---------------- | --------------- |
| 4 | 452 / 572 / 420 | 1 / 0 / 1 |
| 6 | **209 / 206** / 318 | **251 / 286** / 1 |
| 8 | 333 / … | 2 / … |

The suite is **bimodal** at PAR≥6: when it stays healthy it's ~30% faster
(318–333s vs ~452s), but ~half the runs **catastrophically fail** (251–286 of
398) *and finish fast* (~207s). Root cause, traced from the logs:

1. **A worker's kolu server becomes unreachable mid-run** — no crash, no stderr
   (the only server output is the benign SQLite experimental warning). Every
   subsequent scenario on that worker fails at the Before-hook
   `terminal/killAll` reset (`POST …:<port>/rpc/terminal/killAll failed after
   retries`), all on one port.
2. **Queue-drain amplification** — cucumber's parallel workers pull from a shared
   queue. A worker whose server died fails each scenario it pulls in ~0 ms, so it
   *greedily drains the queue*, stealing and failing scenarios that healthy
   workers would have passed. One dead server → hundreds of failures + a fast
   finish. This is why the catastrophic runs are also the fastest.

**Suspected mechanism:** `ulimit -n` on rasam is **256** (macOS default; hard
limit is `unlimited`). The soft limit is inherited by each spawned server. Under
higher total concurrency the server's `accept()` hits **EMFILE** and stops
accepting connections without crashing or logging — exactly the silent
unreachability observed. Fix under test: `ulimit -n 65536` before the suite (a
one-line recipe change). If it makes PAR=8/12 stable, raising parallelism becomes
a real Pareto win; if not, the lever is unsafe and stays at 4.

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
