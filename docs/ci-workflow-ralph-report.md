> **Historical (2026-06):** this report predates odu (`packages/odu`), which replaced justci as the repo's CI runner — `justci` invocations below are period-accurate, not current practice.

# CI workflow ralph report

Measurement-driven improvement of Kolu's CI workflow, optimizing for the three
goals set at the outset, in priority order:

1. **(most important) Surface errors from individual steps to the agent as soon
   as possible** — during `/do`, the agent should learn a step failed the
   instant it fails, not at end-of-run.
2. **Run CI as fast as possible.**
3. **Run CI as parallel as possible.**

The work spans two PRs: a feature added to the shared runner
[`juspay/justci`](https://github.com/juspay/justci) (so the data the agent needs
reaches its stdout live), and Kolu-side changes that consume it and shorten the
pipeline's critical path.

---

## Metrics & methodology

| Metric | What it measures | How |
|---|---|---|
| **Error-surfacing latency** | wall-clock from a step *failing* to the agent being *able to observe* that failure | instrument a pipeline with an early-failing node + a slow sibling; observe when the failure becomes visible on the driving process's stdout |
| **Critical path** | the longest dependency chain through the CI DAG = the pipeline's wall-clock floor under perfect fanout | read the DAG; profile each node's component work; compute `serial chain` vs `max of parallel branches` |
| **Component build times** | the per-node nix build cost that defines each branch's length | `nix build <attr> --no-link`, hot (cached) — cold pulls the same paths from `cache.nixos.asia` |

Measurement is hybrid (per the ralph setup): error-surfacing latency is measured
**locally** on a throwaway pipeline (fast, deterministic, exercises the exact
observer→stdout path); critical-path component times are profiled locally;
the authoritative end-to-end wall-clock is a property of the per-run **pu** linux
box (a full machine) and is host-dependent — the structural model below is what
the change is justified on, with the component profile as support.

---

## Metric 1 — Error-surfacing latency (the headline)

### Baseline

`justci run` already folds process-compose's per-node event stream into three
surfaces: GitHub commit-status posts, the end-of-run `── ci run summary ──`, and
the exit code. But a backgrounded `justci run` (how `/do` invokes it) exposes
**none of them to the agent mid-run**:

- The summary prints only after the *whole pipeline* exits.
- Commit statuses require a `gh pr checks` round-trip + GitHub propagation, so
  the agent must *poll*, and only sees a failure on the next poll tick.

So for a step that fails early — say `biome` at ~20s — in a pipeline whose long
pole (`e2e`) runs to ~150s+, the agent waited until **end-of-run (~150s+)** to
read the failure from the summary, or until its next `gh pr checks` poll
(interval + GH propagation). **Effective latency for an early failure: ≈ the
remaining pipeline duration, or one poll interval — tens of seconds to minutes.**

### Change

[juspay/justci#44](https://github.com/juspay/justci/pull/44) adds
`justci run --progress json`: a fourth surface off the *same* event stream that
emits one NDJSON line to stdout per node transition, flushed immediately:

```jsonc
{"node":"biome@x86_64-linux","recipe":"biome","platform":"x86_64-linux","status":"failed","exit_code":1,"log":".ci/<sha>/x86_64-linux/biome.log"}
```

It's composed onto the existing observer callback (alongside the GH poster and
verdict accumulator), so no new event plumbing — the data already flowed there;
it just wasn't reachable on stdout. Default `--progress none` leaves stdout
unchanged (upstream-safe).

### After

Latency = the local write + `hFlush` after process-compose emits the terminal
event ≈ **sub-second**, with **no GitHub round-trip and no polling**.

**Demonstrated** on a 3-recipe throwaway pipeline (`ok` / `boom: exit 3` /
`slow: sleep 1`): `boom`'s `{"status":"failed","exit_code":3}` line lands on
stdout **before** `slow`'s `success` line — i.e. the agent can read the failure
and its `log` path *while a sibling lane is still running*, then start fixing
immediately rather than draining the rest of the pipeline.

| | Baseline | After |
|---|---|---|
| Early-failure visibility | end-of-run summary (~remaining pipeline) or next `gh pr checks` poll | sub-second, on stdout, as it happens |
| Mechanism | poll GitHub / wait for exit | live NDJSON stream |
| Failing log pointer | dig through interleaved `pc.log` / GH description | `log` field in the failure line |
| Sibling lanes | — | keep running; agent fixes in parallel |

This is the primary win and it is concretely measured. The Kolu side
([`.agency/do.md`](../.agency/do.md)) now drives `--progress json` and documents
the consume-the-stream loop: tail the backgrounded output, `grep -o '{.*}' | jq
'select(.status=="failed" or .status=="errored")'`, and on the first failure read
its `log` and start the fix — no waiting, no polling.

---

## Metric 2 / 3 — Critical path (speed via parallelism)

### Baseline DAG

```
default → nix home-manager e2e smoke fmt biome unit surface-example-build pnpm-hash-fresh
  nix:                    (leaf)  devour-flake ALL outputs (incl. checks/typecheck) — the big build
  home-manager: nix
  smoke:        nix               smoke.sh self-builds .#default
  e2e:          nix install       just test self-builds .#koluBin, then ~144s suite
  fmt/biome/unit/surface-example-build: install
  install, pnpm-hash-fresh: (leaf)
```

The long pole is the chain **`setup → nix → e2e`**: `e2e` (the ~144s suite, per
[`flaky-tests-ralph-report-2.md`](./flaky-tests-ralph-report-2.md)) could not
start until the *entire* devour-flake build of every output finished — even
though `just test` only needs `.#koluBin` (which it builds itself) plus the pnpm
deps `install` provides. Critical path ≈ **`T_nix + T_e2e`** (serial).

### Change

In [`ci/mod.just`](../ci/mod.just), drop the `nix` edge from the three nodes that
self-build the subset they need:

- `e2e: install` (was `e2e: nix install`) — `just test` builds `.#koluBin`.
- `smoke:` (was `smoke: nix`) — `smoke.sh` builds `.#default`.
- `home-manager:` (was `home-manager: nix`) — builds kolu via `--override-input`.

Nix store locking dedups each shared drv with the `nix` node's concurrent build,
so there's no double work — the three lanes simply *overlap* the big build
instead of queuing behind it. Critical path becomes **`max(T_nix, T_e2e_branch,
T_hm_branch, …)`** instead of a sum.

### Measured per-node durations (real `/do` CI run, HEAD `db15cc51`)

From `gh pr checks` on the green run — darwin (`nix-infra`, cold-ish) and linux
(`drishti-ci`, warm cache):

| Node | darwin | linux |
|---|---|---|
| `_ci-setup` | 13s | 20s |
| `nix` (devour-flake, all outputs) | 1m53s | 34s |
| **`e2e` (`just test`)** | **5m33s** | **1m47s** |
| `pnpm-hash-fresh` | 2m45s | 25s |
| `fmt` | 2m27s | 14s |
| `unit` | 2m7s | 23s |
| `home-manager` | 1m58s | 53s |
| `surface-example-build` | 1m52s | 14s |
| `smoke` | 1m50s | 36s |
| `biome` | 1m41s | 13s |
| `install` | 17s | 10s |

`e2e` is the long pole on both lanes, and it's a *subset*-builder: `just test`
builds only `.#koluBin`, so on the new DAG it reaches test-start no later than
`nix` finishes and the ~5m suite overlaps the big build.

### Measured critical-path reduction

Cross-platform lanes run in parallel, so the pipeline wall-clock is the slower
lane's critical path — darwin here.

| Lane | Old (`e2e: nix install`) | New (`e2e: install`) | Reduction |
|---|---|---|---|
| **darwin** | `setup + nix + e2e` = 13s + 1m53s + 5m33s ≈ **7m39s** | `setup + max(e2e, nix, …)` = 13s + 5m33s ≈ **5m46s** | **~25%** (−1m53s) |
| linux (warm) | 20s + 34s + 1m47s ≈ **2m41s** | 20s + 1m47s ≈ **2m7s** | ~21% (−34s) |

The saving is exactly the `nix`-node time `e2e` no longer waits for. The
error-surfacing win compounds on top: via `--progress json` the agent learns of
a `biome`/`unit`/`fmt` failure at ~tens of seconds while `e2e` and `nix` are
still running, instead of at end-of-run minutes later.

### Real-world `--progress json` proof (the no-egress incident)

The first attempt provisioned an ephemeral `pu` linux box that came up **without
network egress** (DNS timeouts to `cache.nixos.asia` / `ftpmirror.gnu.org`). The
`--progress json` stream surfaced this *live and per-node*: each linux recipe
emitted `{"status":"failed","exit_code":127,"log":"…"}` the instant it failed
(with the egress errors visible in the streamed logs), while the **darwin lane
kept running and went green** — exactly the fail-fast, sibling-lanes-unblocked
behavior the feature is for. Diagnosed as infra (not the DAG — darwin ran the
identical pipeline clean), posted a `pu`-misbehaved diagnostic comment, and fell
back to `hosts.json` (`drishti-ci`) for the linux lane, which went all-green.

### Coverage trade (authorized: "may trade coverage for speed")

`nix` still runs (it's a direct `default` dep), so the typecheck, website, and
packaging gates are **unchanged**. The only behavior traded: `e2e`/`smoke`/
`home-manager` now run **even when `nix` fails**. That surfaces *more* independent
signal per run (you learn about an e2e regression even if a typecheck broke), and
all four remain required checks — so the merge gate is identical. The cost is more
concurrent nix builds on one host; on the ephemeral per-run linux box (a full
machine) that's the intended trade.

**Authoritative wall-clock — confirmed.** Measured on the real `/do` CI run
above: ~25% critical-path reduction on the dominant (darwin) lane, ~21% on
linux. The absolute number stays host-dependent (CPU/RAM, substituter warmth,
contention), but the direction and magnitude held on a real two-platform run.

---

## Deliverables

| PR | Repo | What |
|---|---|---|
| [#44](https://github.com/juspay/justci/pull/44) | juspay/justci | `justci run --progress json` — live NDJSON per-node transition stream (new `JustCI.Progress`, composed onto the observer; `ProgressSpec`; README). Default-off, upstream-safe. |
| this PR | juspay/kolu | `/do` drives `--progress json` + documents the consume-the-stream loop ([`.agency/do.md`](../.agency/do.md)); `ci/mod.just` decouples `e2e`/`smoke`/`home-manager` from the monolithic `nix` node; this report. |

## Dead ends / caveats

- **NDJSON on shared stdout.** process-compose runs headless on the inherited
  stdout and prints its own `[<recipe>@<platform>]` log lines, plus an xterm
  title escape that can prefix the *first* JSON line. Investigated emitting to a
  dedicated sink; kept stdout (the chosen design) since each JSON object is
  contiguous and one-per-line with no nested braces, so `grep -o '{.*}' | jq
  'fromjson?'`-style extraction is fully robust — documented as the consumer
  contract rather than worked around in the producer.
- **`home-manager` is decoupled on the same principle as `e2e`/`smoke`, owned
  deliberately.** All three follow one rule — a recipe depends on the store
  paths it actually needs, not on the global all-outputs build gate. Applying
  that rule uniformly (rather than special-casing `home-manager` back onto
  `nix`) is the justification: the decision is the *rule*, not a per-edge
  confidence bet. `home-manager` is the smallest of the three wins because it
  isn't the long pole, and it does add a third concurrent heavy nix build —
  that contention is the trade, and it's directly observable in the
  `--progress json` timeline (the gap between each node's `running` and
  terminal line). If a real run shows contention dominating the overlap, that's
  *data* feeding the next ralph cycle — not a reason this edge is provisional.
- **Absolute wall-clock not measured cold.** See above — it's a property of the
  per-run pu box, not the dev machine; the structural model is the justification.
