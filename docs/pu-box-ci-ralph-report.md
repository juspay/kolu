> **Historical (2026-06):** this report predates odu (`packages/odu`), which replaced justci as the repo's CI runner — `justci` invocations below are period-accurate, not current practice.

# pu-box CI ralph report

> **Superseded (2026-06):** the per-run **fork-a-golden** mechanism this report
> delivered (`ci/pu-ci-host.sh`) has been replaced by a **fixed pool of leased
> warm boxes** (`kolu-ci-1..8`, `ci/pu/run.sh` + `just ci::pool-ensure`). The
> headline *measurements* below still hold — warming the Nix store is the lever,
> `ci::nix` collapses 189s → ~12s, and warm boxes are immune to substituter
> contention. What changed is the *delivery*: leasing an always-warm pool box
> sidesteps both `pu fork` bugs entirely (fork is no longer on the hot path), so
> a run pays no fork/create latency and the box stays warm across leases. See
> [`.agency/do.md`](../.agency/do.md) for the current model.


Measurement-driven reduction of the **`x86_64-linux` CI lane wall-clock** — the
pipeline `/do` runs on an ephemeral `pu` box (`kolu-pr-<N>`, a clean 32-core
NixOS Incus container) per PR. Tracks and closes
[juspay/kolu#1173](https://github.com/juspay/kolu/issues/1173).

Prior ralph efforts tuned the **darwin** lane (e2e parallelism,
`docs/ci-e2e-macos-ralph-report.md`), the **nix build derivation**
(`docs/nix-build-ralph-report.md`), and the **CI DAG critical path**
(`docs/ci-workflow-ralph-report.md`). This one targets the part none of them
did: the **cold-start tax a fresh `pu` box pays** on every run.

## TL;DR

- On a **cold** `pu create` box the long pole is **`ci::nix` (189s)** — the box
  re-realises the whole devour-flake closure from the substituter. `ci::e2e`
  runs *underneath* it, so e2e is not even the critical path until the store is
  warm.
- **Warming the store is the one real lever.** Forking a warm "golden" box
  collapses `ci::nix` **189s → 8–12s** and drops the wall from a cold
  **~216–262s** to an e2e-bound **~142–195s**. It is also **immune to the
  substituter contention** that makes concurrent cold runs degrade past 12 min.
- **Raising `CUCUMBER_PARALLEL` past 8 is noise** (≤6% within-box; the e2e suite
  is tail-bound). The first, *uncontrolled* sweep looked like a 30% win — it was
  pure box-placement variance. Not committed.
- The delivery mechanism (`pu fork`) has two real bugs (no `ssh_config`
  cross-host; a slow cross-pool 17 GB transfer that hits an Incus UUID bug).
  `ci/pu-ci-host.sh` works around both and falls back to cold create, so CI is
  never slower than today and gets the warm win whenever the fast fork path is
  available.

---

## Methodology

- **Metric:** wall-clock of the full linux lane = `max(Exited) − min(Started)`
  over all `@x86_64-linux` process-compose events in `.ci/pc.log` (the same
  extraction the #1173 analysis used). Per-recipe durations from the same log.
- **Invocation:** `nix run github:juspay/justci -- run --no-post --platform x86_64-linux --host x86_64-linux=<box> --progress json`,
  run from a fresh local clone per measurement so concurrent `.ci/` dirs never
  collide. `--no-post` keeps strict mode (clean-tree refuse + HEAD pin), skips
  GitHub posts.
- **Box:** Intel i9-14900K, 32 cores, 125 GB RAM (typical `pu` placement).
- **n per condition reported inline; medians where n ≥ 3.** Each run is its own
  fresh box (`pu create`) or fork (`pu fork`), matching real `/do` provisioning.
- **Harness (not committed):** `/tmp/ci-bench/{bench.sh,parse-pclog.sh,e2e-time.sh,fork.sh}`.

A note on rigor: **box-placement variance dominates everything here** (clean
walls ranged 142–301s for the *same* work). Every comparison below that matters
was re-run **within a single box** to remove placement as a confound — see the
parallelism dead end for why that mattered.

---

## Baseline — cold `pu create` (what `/do` does today)

Representative solo cold run (`kolu-ci-bench-0`, n=1), per-recipe:

| recipe | dur |
|---|---|
| **`ci::nix`** | **189.0s** ← long pole (cold store) |
| `ci::e2e` | 125.1s (runs *under* nix) |
| `ci::home-manager` | 112.9s |
| `ci::smoke` | 87.7s |
| `ci::install` | 69.3s |
| `ci::pnpm-hash-fresh` | 67.4s |
| `ci::docs-moc` | 57.6s |
| `ci::unit` | 23.8s |
| `_ci-setup` | 16.1s |
| `ci::surface-example-build` | 15.6s |
| `ci::biome` | 14.9s |
| `ci::fmt` | 14.4s |
| **LANE_WALL** | **215.7s** |

| condition | wall | source |
|---|---|---|
| cold create, solo | 215.7s | this report (n=1) |
| cold create, established median | 262s | #1173 (n≈10) |
| cold create, slower placement | 301s | this report |
| **cold create, 5 boxes concurrently** | **2 of 5 stalled > 12 min** | this report — substituter/registry contention |

The last row is its own finding: launching 5 cold boxes at once had them all
pulling the kolu closure from `cache.nixos.asia` + npm registry simultaneously,
and `ci::nix` / `ci::install` on the later finishers stalled past 12 minutes.
**Cold CI degrades catastrophically under concurrent multi-PR load** — exactly
the load real CI sees. A warm fork pulls *nothing* from the substituter, so it
is immune to this.

---

## Lever 1 (headline) — warm the Nix store via `pu fork`

Fork a long-lived warm "golden" box (its store pre-realised by one prior CI run)
instead of `pu create`-ing a cold one. The fork inherits the hot `/nix/store`
(62 k paths) and the warm pnpm store.

**Warm-fork full pipeline (n=3 clean):**

| run (box) | `ci::nix` | `ci::home-manager` | `ci::e2e` | wall |
|---|---|---|---|---|
| fast box | 12.1s | 36.4s | 105.0s | **141.7s** |
| slow box | 8.0s | 13.1s | 154.5s | **194.2s** |
| slow box | 21.5s | 45.7s | 150.5s | **195.4s** |

| | cold `pu create` | warm fork | Δ |
|---|---|---|---|
| `ci::nix` | 189s | **8–12s** | **−94%** |
| `ci::install` | 69s | 24s | −65% |
| `ci::pnpm-hash-fresh` | 67s | 25s | −63% |
| `ci::home-manager` | 113s | 13–46s | −60–88% |
| **LANE_WALL** | **216–262s** | **142–195s** | **−26 to −46%** |

The cold-tax recipes collapse exactly as predicted. The wall does **not** fall
by the full 180s `ci::nix` saving, because `ci::e2e` was already running
underneath `ci::nix` on the cold box — so warming the store simply **exposes
`ci::e2e` as the new floor**. The bigger practical win is qualitative: the warm
fork is **immune to the concurrent-load contention** above.

---

## Lever 2 (dead end) — `CUCUMBER_PARALLEL` past 8

The 32-core box runs the e2e suite at `CUCUMBER_PARALLEL=8` (the clamp ceiling),
leaving ~24 cores idle — so #1173 expected headroom here. There isn't much.

**First sweep (one PAR value per box) — looked like a 30% win:**

| PAR | box | e2e |
|---|---|---|
| 8 | fork-1 | 104.6s |
| 16 | fork-p16 | 74.7s |
| 24 | fork-p24 | 72.1s |

This is **wrong** — it compared par8-on-a-slow-box against par16-on-a-fast-box.
Re-running each PAR **within the same box** removes the confound:

| box | par8 | par16 | par24 |
|---|---|---|---|
| fork-p24 (fast) | 74.1s | 69.9s | 71.8s |
| fork-p16 (fast) | 76.1s | 73.7s | — |
| fork-1 (slow) | 108.4s | 107.6s | — |

Within-box, **8 → 16 buys ~3–6% on fast boxes and ~0% on the slow box** — at or
below the ralph noise floor (3% for time), and with huge run-to-run variance.
The e2e suite is **tail-bound** (the slowest scenario gates the wall), so cores
past ~8 barely help — consistent with the darwin report's finding that PAR > 8
regressed its 24-core host. **Not committed.** Touching the shared clamp would
also risk regressing the tuned darwin lane for no reliable gain.

---

## Lever 3 / secondary findings (documented, not changed)

- **`_ci-setup` transfer (~16–18s).** Setup ships the nix closure
  (`nix-store --export | ssh … --import`) + a full `git bundle --all`. With a
  warm fork the store push is largely a no-op; the git bundle could be shallow
  (HEAD only). Both live in **justci's** generated `_ci-setup` command — an
  upstream change, not Kolu's to make here. Filed as a note for juspay/justci.
- **In-pipeline e2e contention (~+40s).** Isolated, `ci::e2e` is 74–108s; inside
  the full pipeline it is 105–154s on the *same* box. The concurrent warm builds
  (`home-manager`, `pnpm-hash-fresh`, `nix`) burst CPU at e2e's startup and steal
  cores. On a cold box this was hidden under `ci::nix`; warming exposes it as the
  next bottleneck. Left as future work — the DAG overlap is deliberately tuned
  (see `ci-workflow-ralph-report.md`) and re-serialising risks the merge gate.

---

## `pu fork` bugs (worked around in `ci/pu-ci-host.sh`; should be fixed in `pu`)

1. **No `ssh_config` written.** `pu create` writes
   `~/.pu-state/<host>/ssh_config` (consumed by `~/.ssh/config`'s `Include`), so
   raw `ssh <host>` — which justci uses over the wire — resolves. `pu fork` does
   **not**, so a forked box is unreachable by justci even though `pu connect`
   works. Workaround: synthesize the config from the source box's (same gateway,
   only the Host name + `connect <name>` target differ).
2. **Cross-pool fork is slow and crashes.** When the fork lands on the source's
   Incus storage pool it's a fast copy-on-write snapshot. Across pools it does a
   full instance transfer (~17 GB, ~160s @ ~110 MB/s) that then fails with
   `Error: … Failed setting received UUID: Failed parsing UUID: invalid UUID
   length: 0`. Workaround: bound `pu fork` with a timeout so only the fast CoW
   path is ever used; otherwise fall back to a cold create (never a net
   slowdown).

The robust long-term alternative to fork is a **shared binary-cache substituter**
(Cachix/attic/local S3): a cold box would *pull* the warm closure instead of
rebuilding it, getting most of Lever 1's win without depending on fork placement.
That's infra outside this repo; the fork path is the self-contained mechanism
deliverable here.

---

## Deliverables

| file | what |
|---|---|
| `ci/pu-ci-host.sh` | Provision a warm linux CI host: timeout-guarded fork of `kolu-ci-golden` (with `ssh_config` synth) → cold `pu create` → (empty ⇒ `hosts.json`). Tested end-to-end. |
| `.agency/do.md` | `/do`'s CI step calls `ci/pu-ci-host.sh`; documents keeping the golden box warm. |
| `docs/pu-box-ci-ralph-report.md` | this report |

Not changed (deliberately): the `CUCUMBER_PARALLEL` clamp (Lever 2 is noise).

---

## Optimization log

| # | change | lever | result | committed? |
|---|---|---|---|---|
| 1 | fork warm golden box instead of `pu create` | warm Nix store | `ci::nix` 189→8–12s; wall 216–262→142–195s (−26–46%); immune to concurrent-load contention | yes |
| 2 | raise `CUCUMBER_PARALLEL` 8→16 | e2e parallelism | ≤6% within-box (noise); e2e is tail-bound | no (dead end) |
| 3 | shallow `_ci-setup` bundle / warm store push | transfer trim | ~16s, but justci-internal | upstream note |

## Dead ends

- **`CUCUMBER_PARALLEL` > 8** — within-box gain ≤6%, below noise; suite is
  tail-bound. The apparent 30% win was box-placement variance.
- **Cross-pool `pu fork`** — 17 GB transfer + Incus UUID crash; slower than cold.
  Guarded against rather than used.

## Key findings

1. On a cold box the linux wall is **`ci::nix`-bound**, not e2e-bound.
2. **Warming the store is the only large, safe lever**; everything else is the
   newly-exposed e2e floor.
3. **Box-placement variance dominates** — measure within-box or be fooled.
4. **Cold CI collapses under concurrent load**; warm forks don't touch the
   substituter, so they don't.
5. `pu fork` needs two fixes to be a dependable production mechanism.
