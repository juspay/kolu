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

## Result (same harness, same host, medians)

| | Baseline (PAR=4) | After (PAR=8 + fixes) | Δ |
| --- | --- | --- | --- |
| e2e suite wall-clock (`cuke_s`) | **~450 s** | **~156 s** | **−65%** |
| Total (`total_s`) | ~452 s | ~159 s | −65% |
| Clean-run reliability | 1/3 runs flaked (code-tab `[branch]` hard-fail) | **3/3 green, 0 retries** | ✓ |

The win is two-layered: **4→8 workers** on the idle 24-core host removes ~48% of
the wall-clock, and the **flake fixes** remove the remaining time that
failing/retrying scenarios burned at 20–40 s each (baseline b1 skipped 43 steps
to retries; the final runs skip 0). Both land in the real `just test` →
`ci::e2e` path. The catastrophic bimodal failure that *looked* like a
parallelism ceiling turned out to be a retry-blind harness bug (below).

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

### Root cause (adjudicated by a parallel theory-test workflow)

Five candidate mechanisms were tested in parallel against the captured logs +
source. **All five were refuted**, and the true mechanism — which none of the
initial hypotheses named — was isolated with high confidence:

- ✗ **EMFILE / fd-256** — no `EMFILE`/`ENFILE` anywhere; the failure is isolated
  to *one* server (not all); the wedged server passed *zero* scenarios so nothing
  accumulated; and PAR=8 ran clean at *higher* concurrency. (The 256 limit is
  real but not the trigger.)
- ✗ **get-port TOCTOU** — six distinct ports per run, each claimed once.
- ✗ **ephemeral-port / TIME_WAIT** — no `EADDRNOTAVAIL`/`EADDRINUSE`.
- ✗ **CPU event-loop stall** — `postJSONOnce` has *no* timeout, so a live-but-
  stalled server would **hang**, not fail fast; the errno is `ECONNREFUSED`
  (process *gone*), not `ETIMEDOUT`/`ECONNRESET`.
- ✗ **orphan-server confound** — failures hit the worker's *own* freshly-bound
  port, not a foreign one.

**Actual mechanism:** a single worker's spawned kolu server **dies** mid-run
(`ECONNREFUSED` on its own port; it had passed `/api/health` and logged only the
benign SQLite `ExperimentalWarning`). Two *harness* defects then turn one dead
server into a catastrophe:

1. **`isTransientSetupError` checked only `err.message`, not `err.code`**
   (`hooks.ts:152`). Node raises a dual-stack `AggregateError` for a refused
   connection whose `.message` is **empty** and whose real errno (`ECONNREFUSED`)
   lives on `.code`/`.errors[].code`. So the Before-hook reset **bailed on the
   first attempt with zero retries** and rethrew `…killAll failed after
   retries:` with an empty tail (matches 1179/1179 failing lines byte-for-byte).
2. **Queue-drain amplification** — cucumber workers pull from a shared queue, so
   the now-instant-failing worker greedily drains ~251 scenarios (vs ~29 for each
   healthy worker). One dead server ⇒ 251–286 failures *and* the fast finish.

The **death cause itself was invisible**: the server's stdout was suppressed
unless `KOLU_TEST_VERBOSE`, and there was no exit log — so nothing distinguished
a crash from a wedge. Both defects are fixed in the **harness-hardening** cycle
below, and an instrumented campaign (clean-start + `ulimit -n 65536` + per-worker
server logs + exit logging) re-runs PAR=6/8 to confirm the blast radius is capped
and to capture *why* a server dies if it recurs.

## Optimization log

Per-PAR medians (cucumber phase only; `build_s`/`install_s` ≈ 1s on the warm
store). Catastrophic runs excluded from the duration median (they fail fast and
aren't a real timing).

| Config | runs | med cuke_s | catastrophic | note |
| ------ | ---- | ---------- | ------------ | ---- |
| PAR=4 (baseline) | 3 | ~450 | 0 | the old CI setting |
| PAR=6 (ulimit 256, dirty) | 3 | 318 (1 clean) | **2/3** | orphan/retry-blind cascade |
| PAR=8 (ulimit 256) | 3 | ~242 | 0 | already ~46% faster |
| PAR=12 (ulimit 256) | 1 | 360 | 0 | **slower** than 8 (tail+contention) |
| PAR=8 (hardened, ulimit 65536) | 3 | ~233 | 0 | parallelism only |
| PAR=6 (hardened, clean-start) | 3 | 210 | **0/3** | cascade gone |
| **PAR=8 + all flake fixes (final)** | 3 | **~156** | 0 | **adopted — 398/398, 0 retries** |

| Cycle | Axis | Change | Outcome |
| ----- | ---- | ------ | ------- |
| 1 — Parallelism sweep | duration | Measure 4/6/8/12 on the idle 24-core host | **PAR=8 is the knee**: cuke ~450s→~233s (**−48%**). PAR=12 *slower* (overhead + the ~34s slowest-scenario tail). Committed past noise. |
| 2 — Root cause (theory workflow) | flakiness | 5 hypotheses tested in parallel vs the captured logs | All 5 refuted; pinned to **single-server-death + retry-blindness + queue-drain** (see above). |
| 3 — Harness hardening | flakiness | `isTransientSetupError` checks `err.code`/`AggregateError`; errno in error tail; per-worker server log + exit log; `postJSONOnce` rejects non-2xx | PAR=6 clean-start went **2/3 catastrophic → 0/3**; 6 hardened runs, **0 server deaths**, no retries needed. Cascade amplifier removed; deaths now diagnosable. |
| 4 — code-tab branch barrier | both | Block on `git push` completion before branch-mode `gitStatus` subscribes | Removes the baseline hard-fail (`code-tab.feature` `[branch]`, failed both attempts in b1/b3/i8b) and the ~40s of POLL_TIMEOUT it burned. |
| 5 — codex fixture `BEGIN IMMEDIATE` | flakiness | Atomic DELETE+INSERT row-swap | Closes the null/null reconcile-gap race (worse at higher PAR); mirrors the OpenCode fix. |
| 6 — Adaptive parallelism + ulimit | duration | `CUCUMBER_PARALLEL` ≈ cores/3 clamped [4,8]; `ulimit -n 65536` | Lands the PAR=8 win in the real `just test` (→ `ci::e2e`) on rasam, keeps laptops at 4, adds fd insurance. |

---

## Dead ends

- **Collapsing the triple `pnpm install` / nested devshell** — sub-noise on the
  warm store (`install_s` ≈ 1s; `koluBin` cached). Documented, not committed.
- **Raising `CUCUMBER_PARALLEL` to 12** — *slower* than 8 on 24 cores (the
  ~34s slowest scenarios + worker contention dominate past 8). PAR=8 is the knee.
- **EMFILE / fd-256 as the catastrophe cause** — disproven by the theory
  workflow (raising `ulimit` is still kept as cheap insurance, not a fix).
- **Trimming `HYDRATION_TIMEOUT` / the mobile "does-not-summon-keyboard" 30s
  scenarios** — not pursued: those waits guard real negatives and the 60s
  hydration margin absorbs the darwin slow-hydration tail with one retry. (Noted
  from the prior reports' dead-ends to avoid repeating.)

---

## Findings

1. **The suite is the cost; parallelism is the lever.** On rasam's warm store the
   only meaningful wall-clock is the cucumber phase. Going 4→8 workers on the idle
   24-core host cut it ~48% — the single biggest win. 12 is past the knee.
2. **The "parallelism is unsafe" scare was a harness bug, not a host limit.** The
   bimodal catastrophe at PAR=6 was a single server dying once and a *retry-blind*
   error classifier turning that into a 251-scenario queue-drain. Fixing the
   classifier (match `err.code`, not just `.message`) restores the intended
   retry; hardened PAR=6 went 2/3-catastrophic → 0/3.
3. **A parallel theory-test workflow earned its keep.** Five plausible causes
   (fd/EMFILE, get-port, TIME_WAIT, CPU-stall, orphan) were all refuted against
   the logs, redirecting the fix from "raise ulimit and hope" to the real
   classifier/observability bug — which a single-threaded guess (mine was EMFILE)
   would have gotten wrong.
4. **Observability was the missing piece.** The server death emitted nothing;
   per-worker server logs + exit logging now make any recurrence diagnosable
   instead of a silent 251-failure mystery.

---

## Cost breakdown

- **Adaptive parallelism**: 8 servers + 8 Chromium contexts on a 128 GB / 24-core
  host — load avg peaked ~12 (half the cores), comfortable headroom.
- **`ulimit -n 65536`**: free; the hard limit is `unlimited`.
- **`err.code` retry / non-2xx**: zero on green runs (only widens what the
  already-intended retry catches / surfaces an already-failing reset).
- **Per-worker server log**: one append-stream per worker, drained data that was
  already being read off the pipe — negligible.
- **code-tab barrier / codex transaction**: one extra `echo`+buffer-wait per
  branch fixture; a single SQLite transaction per codex fixture — sub-ms.
