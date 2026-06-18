# `.repro/` — reproduction work for issue #1399

GPU page-fault cascade ([#1399](https://github.com/juspay/kolu/issues/1399)),
follow-up to [#1308](https://github.com/juspay/kolu/issues/1308).

## TL;DR

The issue blames two unmerged #1308 proposals — **P2** (ResizeObserver→`fit()`
oscillation) and **P4** (`--app-h` sub-pixel churn). Reproduced on a clean box
(identical code, P2/P4 absent), under heavy load (8 terminals + continuous
output), at integer **and** fractional scaling, plus canvas zoom/pan: **zero**
self-generated geometry churn. kolu writes geometry only **1:1 with real
resizes**, `fit()` fully rAF-absorbed. This matches the maintainer's own #1308
measurement (`docs/perf-investigations/dock-and-eventloop-1308.md`). The crash's
faulting client is `chromium:cs0` (Chromium GPU/compositor) — the cause is below
kolu (Chromium SharedImage / Mutter 49 / Mesa 25.2.6 / Navi 21). P2/P4 are
**falsified** as the cause; the W6800-specific regime still needs an on-hardware
measurement.

## Files

- `repro-1399.mjs` — the Playwright measurement harness (instruments
  ResizeObserver / `setProperty('--app-h')` / visualViewport / `FitAddon.fit`).
- `results/clean-box-dpr1.json`, `results/clean-box-dpr15.json` — measured
  output from a clean pu box at dpr 1 and 1.5.
- `runbook-1399.md` — manual on-hardware test (console telemetry + drivers).
- `handoff-1399.md` — **self-contained handoff for the reporter** to run on the
  real W6800 box (NixOS grant + manual path + one-command opencode path + verdict
  table). Start here.
- `live/` — reference automation: `safety-monitor.sh` (kernel-fault abort),
  `drive-live.mjs` (CDP precursor probe), `run.sh` (orchestrator),
  `nixos-k1399.nix` (minimal `dmesg_restrict=0` grant).

## Safety

The on-hardware test can crash a live Wayland session (MODE1 reset). The
automation hard-aborts on the first kernel fault / `ProduceSkia` / VRAM>92%; never
run synthetic GPU stress or touch amdgpu reset/debugfs.
