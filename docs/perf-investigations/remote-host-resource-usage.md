# Remote-host resource usage running log

Running investigation log for Chrome CPU and memory growth after the
remote-host feature shipped at <https://kolu.dev/remote-hosts/>.

The goal is to optimize the Kolu client from measurement, not hypothesis. Every
claim below should name the exact workload and the measurement source.

---

## 2026-07-10 — Starting point

### Reported symptom

On a MacBook running Kolu as a PWA / app, Chrome Task Manager showed:

| Task | Memory Footprint | CPU | GPU Memory | JavaScript Memory |
|---|---:|---:|---:|---:|
| App: Kolu | 1.4 GB | 48.9 | 146 MB | 367,200K (298,860K live) |

This is the motivating symptom: high sustained CPU and memory, enough to drain
battery quickly.

### Suspected change window

The climb appears to have started after the remote-host work was introduced:

- Kolu gained a host strip and per-host canvas state.
- A Kolu session can now have multiple live padi/kaval hosts.
- The test workload should cover three hosts total:
  - local
  - `kolu-e2e-remote@localhost`
  - `sincereintent`

### Linux baseline from the current Nix-run harness

Harness:

- URL: `http://127.0.0.1:44363`
- Launch shape: `KOLU_STATE_DIR=... KOLU_PADI_STATE_DIR=... KOLU_PADI_HOST=kolu-e2e-remote@localhost nix run . -- --host 127.0.0.1 --port 44363`
- Active remote host: `kolu-e2e-remote@localhost`
- Visible terminals: 2 xterm terminals on the remote host
- Measurement source: local Linux `/proc`, Chrome DevTools trace, forced-GC heap snapshot

Measured idle numbers:

| Scope | Memory | CPU |
|---|---:|---:|
| Active Kolu renderer | RSS ~229 MiB, PSS ~142 MiB, private ~105 MiB | ~0.4% of one core |
| Whole Chrome tree | summed RSS ~994 MiB, summed PSS ~419 MiB | ~0.6% of one core |
| JS heap after forced GC | ~21.2 MB used | n/a |

Trace notes:

- DevTools idle trace window: 15.9 s.
- Renderer main thread: ~1.2% of one core during the trace.
- Renderer all traced threads: ~1.6% of one core during the trace.
- Chrome compositor/GPU work was higher while tracing than after tracing stopped.

Artifacts:

- `.dev-server/nix-tab-memory-after-gc.json`
- `.dev-server/nix-tab-proc-sample.json`
- `.dev-server/nix-tab-trace-summary.json`
- `.dev-server/chrome-process-memory.json`
- `.dev-server/chrome-process-cpu.json`

### Early interpretation

The Linux headless run is not reproducing the MacBook symptom yet. The current
two-terminal remote-host session is quiet: low renderer CPU, low live JS heap,
and moderate PSS.

That means the next step is to reproduce the high-resource shape with a heavier,
more faithful multi-host workload before changing code.

### Balanced three-host idle baseline

Harness:

- URL: `http://127.0.0.1:44363`
- Browser viewport: 1440x900
- Hosts connected: local, `kolu-e2e-remote@localhost`, `sincereintent`
- Terminal count: 5 on each host
- Selected host while measuring: local
- Visible terminals while measuring: 5
- Measurement window: 15 s `/proc` sample, then DevTools trace and heap snapshot

Host verification snapshots:

- `.dev-server/snapshot-before-5-each.txt`
- `.dev-server/snapshot-e2e-before-topup.txt`
- `.dev-server/snapshot-local-after-5.txt`

Process metrics from `.dev-server/chrome-3host5-idle-procs.json`:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1157.5 MiB | 535.3 MiB | 330.4 MiB | 8.47% of one core |
| Selected Kolu renderer | 325.9 MiB | 220.4 MiB | 164.9 MiB | 1.07% of one core |
| Chrome GPU process | 193.7 MiB | 113.4 MiB | 69.1 MiB | 7.27% of one core |

DOM / JS metrics:

| Metric | Value |
|---|---:|
| DOM nodes | 855 |
| xterm roots | 5 |
| canvases | 15 |
| iframes | 0 |
| JS heap after forced GC | 36.4 MB used / 38.0 MB total |
| Heap snapshot file | 55 MB |

Trace metrics from `.dev-server/trace-3host5-idle-summary.json`:

| Scope | Busy |
|---|---:|
| Renderer main thread | 1.1% of one core |
| Renderer all traced threads | 1.4% of one core |
| GPU process traced threads | 4.1% of one core |
| Paint events | 82 |
| Begin-frame events | 424 |

Interpretation:

- Hidden hosts are not keeping their terminal DOM mounted in this state:
  `xtermRoots=5`, not 15. That lowers suspicion on remote-host tabs themselves
  as the immediate renderer-memory multiplier.
- The selected host has five visible xterms and 15 canvas elements, so canvas /
  compositor cost remains a live suspect.
- In this Linux headless run, idle CPU is dominated by the Chrome GPU /
  compositor path, not JS heap or renderer main-thread work. This is not a
  one-to-one match for the user's Mac Task Manager numbers, but it is the
  strongest local signal so far.

Artifacts:

- `.dev-server/chrome-3host5-idle-procs.json`
- `.dev-server/dom-3host5-idle.json`
- `.dev-server/jsheap-3host5-idle-after-gc.json`
- `.dev-server/heap-3host5-idle.heapsnapshot`
- `.dev-server/trace-3host5-idle.json`
- `.dev-server/trace-3host5-idle-summary.json`

### History-loaded `sincereintent` repro

Workload added on top of the balanced three-host setup:

- Local host: 5 terminals, ~700 generated output lines per terminal, plus one
  short live-output burst.
- `kolu-e2e-remote@localhost`: 5 terminals, ~700 generated output lines per
  terminal, plus one short live-output burst.
- `sincereintent`: existing agent-heavy workspace reattached, including:
  - Codex tile awaiting input with ~21.1K context display.
  - Code panel open on `~/code/kolu-macos`.
  - Three shell terminals received ~700 generated output lines each, plus one
    short live-output burst.

After the bursts finished, the UI was visibly idle. The selected host was
`sincereintent`.

Process metrics from `.dev-server/chrome-3host-history-idle-procs.json`:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1270.6 MiB | 637.9 MiB | 422.7 MiB | 121.07% of one core |
| Selected Kolu renderer | 416.7 MiB | 306.6 MiB | 246.7 MiB | 5.53% of one core |
| Chrome GPU process | 207.1 MiB | 123.5 MiB | 75.8 MiB | 115.00% of one core |

Repeated several minutes later, with the UI still idle:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1269.1 MiB | 627.2 MiB | 402.7 MiB | 121.27% of one core |
| Selected Kolu renderer | 403.9 MiB | 290.9 MiB | 228.0 MiB | 5.33% of one core |
| Chrome GPU process | 215.1 MiB | 128.7 MiB | 78.3 MiB | 115.40% of one core |

DOM / JS metrics:

| Metric | Value |
|---|---:|
| DOM nodes | 1038 |
| xterm roots | 7 |
| canvases | 15 |
| JS heap after forced GC | 61.9 MB used / 63.4 MB total |
| Heap snapshot file | 88 MB |

Trace metrics from `.dev-server/trace-3host-history-idle-summary.json`:

| Scope | Busy |
|---|---:|
| Renderer main thread | 4.7% of one core |
| Renderer all traced threads | 6.0% of one core |
| GPU process traced threads | 96.9% of one core |
| Paint events | 70 |
| Begin-frame events | 2976 |

Live DOM inspection found exactly two active CSS animations:

- A large `.tile-aura` on the inactive `waiting-fresh` Codex tile
  (`798x538` screen rect).
- One `animate-pulse` agent-state icon.

The mounted aura was:

| Field | Value |
|---|---|
| `data-aura` | `waiting-fresh` |
| `data-active` | unset |
| `.tile-aura::before` animation | `tile-aura-spin` |
| Tile | existing Codex terminal on `sincereintent` |

Live CSS experiments on the same idle page:

| Experiment | Active animations | Whole Chrome CPU | GPU CPU | Renderer CPU |
|---|---:|---:|---:|---:|
| Baseline history idle | 2 | 121.27% | 115.40% | 5.33% |
| Freeze only `.tile-aura` | 1 | 69.33% | 65.33% | 3.33% |
| Freeze all CSS animations/transitions | 0 | 28.13% | 26.87% | 1.27% |
| Freeze all + blur focused terminal | 0 | 0.53% | 0.13% | 0.27% |

Interpretation:

- The high idle CPU is reproduced locally.
- The dominant bucket is Chrome compositor/GPU work, not JS heap.
- The first source is persistent CSS animation, especially the canvas
  `waiting-fresh` aura.
- The remaining source after CSS freezes is focused xterm cursor blinking.
- Remote-host streams and hidden-host terminal mounts are not needed to sustain
  the high idle CPU once the visible canvas has a waiting agent and focused
  terminal.

Artifacts:

- `.dev-server/chrome-3host-history-idle-procs.json`
- `.dev-server/chrome-history-idle-repeat-procs.json`
- `.dev-server/dom-3host-history-idle.json`
- `.dev-server/jsheap-3host-history-idle-after-gc.json`
- `.dev-server/heap-3host-history-idle.heapsnapshot`
- `.dev-server/trace-3host-history-idle.json`
- `.dev-server/trace-3host-history-idle-summary.json`
- `.dev-server/animations-history-idle.json`
- `.dev-server/aura-live-dom.json`
- `.dev-server/chrome-history-aura-frozen-procs.json`
- `.dev-server/chrome-history-all-animations-frozen-procs.json`
- `.dev-server/chrome-history-all-animations-frozen-blurred-procs.json`

### First fix and verification

Code change:

- Make canvas tile aura static by default. The aura still renders the same
  colored/dashed/comet state cue, but no longer spins or pulses forever.
- Remove perpetual spin/pulse from `AgentIndicator`.
- Make `LiveActivityDot` a static green cue.
- Set xterm `cursorBlink: false` so a focused idle terminal does not schedule
  cursor repaint work.

Verification harness:

- Rebuilt with `nix build .#default`.
- Ran `result/bin/kolu --host 127.0.0.1 --port 56017` with isolated
  `KOLU_STATE_DIR` / `KOLU_PADI_STATE_DIR`.
- Connected `kolu-e2e-remote@localhost` and added `sincereintent`.
- Selected the same `sincereintent` workspace: waiting Codex tile, code panel,
  focused terminal, 15 canvases, 7 xterm roots.

The fixed build's DOM had a mounted `waiting-fresh` `.tile-aura`, but all
animation names were `none` and `document.getAnimations({ subtree: true })`
returned `0`.

Process metrics from `.dev-server/fixed-sincere-procs.json`:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1167.3 MiB | 548.1 MiB | 346.6 MiB | 0.47% of one core |
| Selected Kolu renderer | 337.7 MiB | 236.1 MiB | 184.5 MiB | 0.40% of one core |
| Chrome GPU process | 175.8 MiB | 100.9 MiB | 61.9 MiB | 0.07% of one core |

Trace metrics from `.dev-server/fixed-sincere-trace-summary.json`:

| Scope | Before | After |
|---|---:|---:|
| Renderer main thread | 4.7% | 0.5% |
| Renderer all traced threads | 6.0% | 0.6% |
| GPU process traced threads | 96.9% | 0.1% |
| Paint events | 70 | 0 |
| Begin-frame events | 2976 | 171 |

Post-GC JS:

| Metric | Value |
|---|---:|
| JS heap after forced GC | 32.6 MB used / 34.1 MB total |
| Heap snapshot file | 48 MB |

The CPU result is the load-bearing win: the same visible high-CPU surface drops
from a sustained ~121% of one core to ~0.5% in this Linux/headless harness.

Artifacts:

- `.dev-server/fixed-sincere-dom-animations.json`
- `.dev-server/fixed-sincere-procs.json`
- `.dev-server/fixed-sincere-js-after-gc.json`
- `.dev-server/fixed-sincere.heapsnapshot`
- `.dev-server/fixed-sincere-trace.json`
- `.dev-server/fixed-sincere-trace-summary.json`

### Browser memory pass: xterm scrollback + WebGL budget

Follow-up symptom:

- The CPU fix made the idle page quiet, but Chrome's tab footprint could still
  climb toward the user's ~1.1-1.4 GB Task Manager reading in a real session.
- The next suspect buckets were xterm.js history buffers and WebGL/canvas memory.

Harness:

- URL: `http://127.0.0.1:54623`
- Launch shape: built `result/bin/kolu`, isolated with
  `KOLU_STATE_DIR`, `KOLU_PADI_STATE_DIR`, and remote
  `KOLU_REMOTE_PADI_STATE_DIR`.
- Hosts connected: local, `kolu-e2e-remote@localhost`, `sincereintent`.
- Terminal count: 10 local, 5 on `kolu-e2e-remote@localhost`, 5 on
  `sincereintent`.
- History load: 1,500 generated output lines sent through real kaval PTYs to
  every terminal on all three hosts.

Pre-history, selected `sincereintent` with five mounted xterms:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1189.9 MiB | 571.3 MiB | 366.7 MiB | 0.67% |
| Renderers total | 464.4 MiB | 267.0 MiB | 195.7 MiB | 0.40% |
| Selected Kolu renderer | 340.0 MiB | 238.0 MiB | 184.7 MiB | 0.40% |
| Chrome GPU process | 192.9 MiB | 112.7 MiB | 68.2 MiB | 0.13% |

After 1,500 lines on the selected `sincereintent` host:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1204.6 MiB | 578.9 MiB | 367.3 MiB | 1.07% |
| Renderers total | 467.0 MiB | 266.0 MiB | 191.1 MiB | 0.93% |
| Selected Kolu renderer | 342.6 MiB | 236.9 MiB | 180.1 MiB | 0.93% |
| Chrome GPU process | 205.0 MiB | 121.5 MiB | 73.7 MiB | 0.00% |

Heap diff from pre-history to selected `sincereintent`:

| Class | Growth |
|---|---:|
| `native:system / JSArrayBufferData` | +17.5 MB / +14,907 |
| `object:Uint32Array` | +0.9 MB / +14,907 |
| `object:ArrayBuffer` | +0.8 MB / +14,907 |

After switching to the local host with 10 mounted history-loaded xterms:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1387.0 MiB | 748.0 MiB | 523.3 MiB | 0.67% |
| Renderers total | 625.1 MiB | 417.6 MiB | 336.2 MiB | 0.47% |
| Selected Kolu renderer | 500.8 MiB | 388.5 MiB | 325.2 MiB | 0.47% |
| Chrome GPU process | 229.2 MiB | 139.1 MiB | 84.9 MiB | 0.20% |

Heap diff from pre-history to local 10:

| Class | Growth |
|---|---:|
| `native:system / JSArrayBufferData` | +61.7 MB / +45,054 |
| `object:Uint32Array` | +2.7 MB / +45,027 |
| `object:ArrayBuffer` | +2.3 MB / +45,068 |

Interpretation:

- Hidden hosts are still not mounted in the DOM; the selected host owns the
  browser xterm cost.
- The dominant JS/native live-set bucket is xterm scrollback: `Uint32Array` /
  `JSArrayBufferData` grows linearly with rendered history and mounted terminal
  count.
- The selected local canvas had 10 xterms, 24 canvases, and 8 WebGL renderers.
  GPU/native process memory rose alongside the xterm buffer growth.

Code change:

- Reduce the browser xterm hot scrollback window from 50,000 to 10,000 lines.
  This aligns the client hot buffer with kaval's 10,000-line mirror instead of
  keeping a deeper per-mounted-tile buffer live in Chrome.
- Reduce `WEBGL_CONTEXT_CAP` from 8 to 6, preserving a realistic 5-6 terminal
  WebGL working set while lowering steady-state GPU/VRAM pressure for larger
  canvases.

Post-change validation:

- Reused the old-build tab, selected the local host, and deepened the same
  10-terminal local canvas from 1,500 lines to 8,500 generated lines per
  terminal. The old code still held 8 WebGL canvases.
- Launched the changed Nix build on a fresh random port with the same three-host
  seed list, created 10 local terminals, and sent the same 7,000-line burst to
  every local terminal. The changed code held 6 WebGL canvases.

Deep local-10 old build:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1564.9 MiB | 915.7 MiB | 680.4 MiB | 0.53% |
| Renderers total | 803.6 MiB | 590.6 MiB | 503.8 MiB | 0.33% |
| Selected Kolu renderer | 679.2 MiB | 561.6 MiB | 492.8 MiB | 0.33% |
| Chrome GPU process | 246.4 MiB | 150.9 MiB | 91.2 MiB | 0.13% |

Deep local-10 changed build:

| Scope | RSS | PSS | Private | CPU |
|---|---:|---:|---:|---:|
| Whole Chrome tree | 1350.8 MiB | 719.9 MiB | 495.0 MiB | 0.60% |
| Renderers total | 627.2 MiB | 420.7 MiB | 337.1 MiB | 0.47% |
| Selected Kolu renderer | 505.9 MiB | 392.2 MiB | 326.2 MiB | 0.47% |
| Chrome GPU process | 229.2 MiB | 137.1 MiB | 80.7 MiB | 0.07% |

Heap class comparison:

| Class | Old deep | Changed deep |
|---|---:|---:|
| `native:system / JSArrayBufferData` | 221.1 MiB / 185,769 | 119.8 MiB / 100,396 |
| `object:Uint32Array` | 10.6 MiB / 185,682 | 5.7 MiB / 100,357 |
| `object:ArrayBuffer` | 9.2 MiB / 185,823 | 5.0 MiB / 100,414 |

Result:

- Whole-Chrome PSS dropped 915.7 -> 719.9 MiB on the deep 10-terminal local
  canvas.
- The selected Kolu renderer's PSS dropped 561.6 -> 392.2 MiB.
- The dominant xterm native buffer class dropped 221.1 -> 119.8 MiB and
  ~185K -> ~100K instances.
- WebGL canvases dropped 8 -> 6 in the same 10-terminal canvas.

Artifacts:

- `.dev-server/memory-3host20-prehistory-procs.json`
- `.dev-server/heap-3host20-prehistory.heapsnapshot`
- `.dev-server/memory-history-sincere-procs.json`
- `.dev-server/heap-history-sincere.heapsnapshot`
- `.dev-server/diff-heap-prehistory-to-sincere.txt`
- `.dev-server/memory-history-local10-procs.json`
- `.dev-server/heap-history-local10.heapsnapshot`
- `.dev-server/diff-heap-prehistory-to-local10.txt`
- `.dev-server/memory-old-deep-local10-dom.json`
- `.dev-server/memory-old-deep-local10-procs.json`
- `.dev-server/heap-old-deep-local10.heapsnapshot`
- `.dev-server/diff-heap-prehistory-to-old-deep-local10.txt`
- `.dev-server/memory-fixed-deep-local10-dom.json`
- `.dev-server/memory-fixed-deep-local10-procs.json`
- `.dev-server/heap-fixed-deep-local10.heapsnapshot`
- `.dev-server/diff-heap-prehistory-to-fixed-deep-local10.txt`

---

## Measurement plan

### Workloads

Run the same measurements across these scenes:

| Scene | Hosts | Terminals | Activity |
|---|---:|---:|---|
| Quiet baseline | 1 local | 0-1 | Idle |
| Remote baseline | local + `kolu-e2e-remote@localhost` | 2 remote | Idle |
| Three-host quiet | local + two remotes | 2-3 per host | Idle |
| Three-host active | local + two remotes | several per host | light output |
| Stress | local + two remotes | enough to match real use | agent/TUI-like output |

### Measurements per scene

- Chrome process tree: RSS, PSS, private memory, CPU ticks.
- Active renderer: RSS, PSS, private memory, CPU ticks.
- Chrome GPU/compositor process: RSS, PSS, private memory, CPU ticks.
- DevTools idle trace: renderer main-thread busy, compositor/GPU-thread busy,
  paint counts, animation-frame activity.
- Forced-GC JS heap: `performance.memory` and heap snapshot size.
- Kolu diagnostics: DOM count, canvas count, xterm count, WebGL lifecycle,
  terminal buffer bytes.

### Questions to answer

- Does cost scale with number of hosts, number of terminals, or active output?
- Are hidden hosts keeping terminals mounted or compositing work alive?
- Are per-host surfaces/streams doing idle work when their host is not active?
- Is the high CPU in renderer JS, CSS/paint/compositor, WebGL/GPU, or terminal
  output processing?
- Is the memory footprint JS-live, xterm scrollback buffers, WebGL/canvas/GPU,
  detached DOM/native bitmap memory, or Chrome baseline?

### Exit criteria for an optimization

- Reproduce the high-resource shape with a named workload.
- Identify the dominant bucket with measurements.
- Change the narrowest code path that owns that bucket.
- Re-run the same workload before/after.
- Prefer Chrome Task Manager numbers on a visible Chrome tab for final MacBook
  proof; use Linux `/proc` + DevTools as the overnight iteration harness.

---

## 2026-07-10 — Second pass (RT / claude): adjudicate before optimizing

Opened to resolve the central tension in the first pass: srid tested the
animation freeze (#1748, commit `919fa65d5`) in practice and reported **no
noticeable difference**, yet the first-pass table shows whole-Chrome CPU
121% → 0.5%. Both cannot describe the same sessions. This pass measures a
**realistic, live** scene (not an otherwise-idle one) across three builds and
writes a verdict per half of #1748, then profiles the real dominant cost.

### Harness note that governs every CPU number below (read first)

All CPU numbers in this section come from the **headless** Chrome the
`chrome-devtools` MCP launches (`--headless=true --isolated=true`), on Linux,
software-rasterized. Two consequences, proven in this pass:

- **Absolute CPU is inflated and MUST NOT be read as srid's Mac numbers.**
  Headless Chrome has no display vsync, so its compositor **free-runs
  begin-frames** whenever any layer animates. Measured: with ONE small
  `statepip-spin` CSS animation running and a single terminal streaming ~20
  lines/s, the GPU-process (VizCompositor) thread produced **119 begin-frames/s
  and 88.6% of one core**; freezing that single animation dropped it to
  **14.8%**. A real vsync-locked GPU caps begin-frames at the display rate
  (60/120 Hz), so this free-run amplification does not occur on srid's Mac.
- **Relative deltas on the SAME build + SAME scene + ONE variable are still
  meaningful** and are the only way these numbers are used below. Absolute CPU
  is kept out of any recommendation table; a headful real-GPU confirmation is
  queued (see "Morning confirmation").

Heap and PSS numbers are compositor-independent and are trustworthy as
absolutes.

### Realistic scene (written down, reproduced identically per build)

- Three hosts bound at launch via `KOLU_PADI_HOST="kolu-e2e-remote@localhost,sincereintent"`
  (local + two real remotes). `sincereintent` isolated with its own
  `KOLU_REMOTE_PADI_STATE_DIR` (state-root digest `515a6a86…`) so srid's real
  remote padi root is never touched; spawned remote daemons reaped by that
  digest at teardown.
- Selected host `local`, 10 mounted tiles: 2 with **15 000-line** deep
  scrollback (past the 10k cap), 6 shallow shells, **1 live producer streaming
  ~20 lines/s** (the live-agent repaint proxy — srid's sessions have live
  agents, codex's repro did not), 2 real `claude` tiles. Code panel open, one
  focused terminal.
- Built + launched isolated (`nix build .#default` → `result/bin/kolu`, random
  port, `mktemp` state dirs), never production. Production `kolu.service`
  (PID 8912) untouched.

Auras were reproduced faithfully by injecting the app's own `.tile-aura`
markup + `data-aura` on 5 tiles (padi's agent-state detection did not engage on
the pinned `claude` build, so the aura was reproduced deterministically rather
than left to a flaky agent scrape). Injected animations matched exactly:
`tile-aura-spin` ×3 (comet), `tile-aura-ants-x/y` (marching ants),
`tile-aura-alert-pulse` — the same names #1748 removed.

### Adjudication — #1748 half 1 (freeze idle animations)

Decomposition, master build, headless harness (**relative CPU only**), 15 s
windows, whole-Chrome CPU (GPU-process CPU in parens):

| Condition | Whole-Chrome CPU | GPU-proc CPU |
|---|---:|---:|
| IDLE + 5 auras ON  (codex's repro shape)           | 102.4% | 98.7% |
| IDLE + auras FROZEN + cursor static (codex's fix)  |   0.1% |  0.0% |
| **LIVE (20 lines/s) + 5 auras ON** (srid's shape)  | **116.2%** | 105.0% |
| LIVE + auras FROZEN                                 |  99.3% | 86.7% |
| LIVE + auras FROZEN + cursor static                |  83.3% | 73.1% |

- In an **otherwise-idle** scene the freeze is decisive: **102.4% → 0.1%**.
  This *reproduces and confirms* the first-pass 121% → 0.5% claim. Codex's
  numbers are real — for that scene.
- In a **live** scene the same freeze removes only ~17% (auras) or ~33%
  (auras + cursor); **~83% of a core keeps burning on live-output GPU raster
  that the freeze never touches.** Under live output the compositor is already
  running every frame for terminal repaints, so the idle animations' *marginal*
  cost collapses.

**Verdict, half 1: CONFIRMED but repro-scoped.** A real, large win only when a
canvas sits idle with waiting-agent auras and a blinking cursor (e.g. overnight,
agents finished, tiles waiting). Near-zero help in an *active* session — which
is srid's daily workload. That, compounded with the headless-inflation caveat
above (the idle-animation cost is additionally smaller on a real vsync GPU than
this harness shows), is why srid observed no difference. Not a refutation — the
fix is correct and harmless — but it is **not the fix for srid's live-session
battery drain.** The dominant real cost is live terminal-output repaint.

### The dominant real cost: live terminal-output repaint

With animations frozen, ONE terminal at ~20 lines/s costs (relative, headless):
renderer-main **~12%** + GPU **~15%** ≈ **28%** of a core steady-state; the
`onRender`→layout→paint→composite pipeline per output chunk. Trace over 18 s of
one producer: 35 paints/s, renderer-main 9.6%. This is the cost that scales with
srid's real workload (N agents × their output rate) and the right optimization
target — pending the real-GPU magnitude.

**Open efficiency question this raises (decided by the real-GPU number, not the
headless one):** even vsync-capped, a perpetual idle CSS animation schedules
60–120 begin-frames/s of compositor work for as long as it runs. So "should
kolu run ANY perpetual animation while a workspace is idle" is a live
battery-grounds question independent of the headless inflation — and it argues
*for* the direction of #1748 half 1, just not for the magnitude it claimed.

### Adjudication — #1748 half 2 (cap scrollback 50k→10k, WebGL 8→6): memory

Mechanism, confirmed from xterm source (`src/common/CircularList.ts`): the
scrollback ring is `new Array(maxLength)` — a **holey pointer array**
preallocated to the cap (~8 bytes/slot), but each line's `BufferLine` cell
buffer (a `Uint32Array`, `CELL_SIZE=3` uint32 × cols ≈ **~960 bytes for an
80-col line**) is allocated **lazily as lines are written**. So:

- For a terminal **under** 10k lines, 50k→10k saves only the pointer array:
  ~(50000−10000)×8 ≈ **320 KB/terminal**. Minor.
- For a terminal **over** 10k lines, the cap evicts real line buffers:
  ~960 bytes × (lines − 10 000) freed. **This is the whole saving**, and it is
  where codex's 221→120 MiB came from — those terminals held ~18k lines, not
  the "8.5k" the first-pass prose suggests.

Heap of the master deep scene (forced-GC snapshot, **trustworthy absolute**):

| Class | Bytes | Instances |
|---|---:|---:|
| `native:system / JSArrayBufferData` | **87.4 MiB** | 78 482 |
| `object:Uint32Array` | 4.5 MiB | 78 456 |
| `object:ArrayBuffer` | 3.9 MiB | 78 508 |

`JSArrayBufferData` (xterm line cell buffers) is **65% of a 135 MiB JS heap** —
one ~960-byte buffer per buffered line, 1:1 with `Uint32Array`. This scales
linearly with *total buffered lines across all mounted tiles*. A long-running
agent terminal streaming for hours climbs toward the 50 000-line cap ≈ **~48 MiB
for that one terminal**; the 10k cap holds it to ~10 MiB.

**Verdict, half 2 (preliminary — full build-to-build heap delta pending): the
cap is REAL and well-targeted for srid's hours-long streaming sessions, but it
is a functionality trade** — the client's visible scrollback and
`exportScrollbackAsPdf.ts` depth both drop 50k→10k. It should ship FLAGGED as a
product decision, not silently. (WebGL 8→6 lowers steady GPU/VRAM baseline but
sits inside the #575/#1399 safe band; low risk.)

### Multi-host differential (idle) — 0 vs 2 remotes bound

srid's regression window points at the remote-hosts feature. Same local scene,
`local` selected, **idle** (producer paused):

| Scope | 2 remotes bound |
|---|---:|
| Renderer CPU | 0.3% |
| GPU CPU | 0.1% |
| Renderer PSS | 327 MiB |
| Whole-Chrome CPU | 0.5% |
| Server-side tree (my instance) | 114 MiB / 0.1% |

At idle, binding two remotes keeps the **renderer** essentially quiet — the
multi-host machinery does not busy-loop the client when the remotes' tiles are
not shown (hidden hosts hold no mounted xterm, matching the first pass). The
per-host host-strip subscriptions (daemonStatus / processMemory / identity /
status cells) are standing but idle-cheap. **The multi-host cost, if material,
lives under remote *activity*, not idle binding** — measured next.

### Long-session leak check — in progress

A `/proc` PSS sampler (renderer + GPU + whole tree, every 90 s) runs over a
continuous-output session past the 50k-line plateau. Result table + verdict
appended when the window completes. (Steady scrollback is capped, so a flat
post-plateau PSS = no steady-output leak; the more dangerous churn leaks —
attach/reattach, focus-driven WebGL context recreation #1399 — are checked
separately with a heap-diff + `check-yn-disposed.mjs` / `find-retainers.mjs`.)

### Memory half — build-to-build heap comparison (trustworthy absolutes)

Deterministic scene, both builds: 6 tiles, each fed `seq 1 15000` (15 000 lines),
then the browser attached and a forced-GC heap snapshot taken.

| Build (client scrollback) | JSArrayBufferData | line-buffers | per-buffer |
|---|---:|---:|---:|
| master-clean (50 000) | 74.1 MiB | 60 235 | 1.26 KB |
| hard-sheath (10 000)  | 74.1 MiB | 60 235 | 1.26 KB |

**Identical.** The reason is load-bearing and was not called out in the first
pass: a **cold-attaching** client receives at most the kaval headless mirror's
snapshot, and `DEFAULT_MIRROR_SCROLLBACK = 10 000` on **both** builds. So the
6×15 000-line terminals delivered only ~10 000 lines each to the browser
regardless of the client's `DEFAULT_SCROLLBACK`. The client's 50k vs 10k window
**only diverges for output produced LIVE while the client is attached and
watching** — that path fills xterm's `CircularList` (hard `maxLength`) past 10k
on master, but is structurally capped at 10k on hard-sheath.

So the real per-terminal saving applies to a **live-streaming** terminal (an
agent producing output while you watch — srid's exact case):

- master: up to 50 000 lines × 1.26 KB ≈ **63 MiB**
- hard-sheath: 10 000 × 1.26 KB ≈ **13 MiB**
- **saving ≈ 49 MiB per live-streaming terminal**, realised only once it streams
  past 10k lines.

And the master 50k client buffer is **ephemeral** — a reconnect / host-switch
resets the client and re-seeds it from the 10k mirror snapshot, so a user rarely
has 50k of client scrollback to lose in the first place. That makes the
functionality cost of the cap (client scroll depth + `exportScrollbackAsPdf`
depth 50k→10k) **materially smaller than "you lose 40k lines of history"**
implies — the client-only 40k above the mirror is already transient.

**Verdict, half 2: CONFIRMED, mergeable, flag as a scrollback-depth product
decision.** It genuinely bounds the dominant browser-memory bucket (xterm line
buffers) for long-running live agents, at a functionality cost that is real but
smaller than it first appears. (WebGL 8→6: only binds when >6 tiles want WebGL;
at ≤6 tiles both builds held 13 canvases. Low-risk, low-frequency benefit.)

### Long-session leak check — no unbounded steady-output leak

A `/proc` PSS sampler ran over continuous output; a fast fill was then used to
saturate the scrollback caps quickly. Forced-GC heap at saturation:
**JSArrayBufferData = 128 517 line-buffers**, which equals the **sum of the
per-terminal 50k caps** in the scene (two live producers at 50k + deep tiles).
The `CircularList` `maxLength` cap holds structurally: lines evicted past the cap
are released, so PSS **plateaus** rather than climbing without bound. Renderer
PSS reached ~710 MiB on an 11-tile heavy scene — approaching srid's 1.4 GB
Task-Manager reading — but as a **bounded** steady state (capped buffers ×
tiles + WebGL/native), NOT a leak.

xterm's `WriteBuffer` additionally has a safety limit that **discards** excess
input under extreme burst rather than growing unbounded (data loss, not OOM), so
even a runaway-fast producer can't balloon the WriteBuffer to OOM.

**Conclusion: srid's 1.4 GB is explained by bounded-but-large steady state, not
a leak.** The levers are therefore (a) fewer/shallower live buffers (the
scrollback cap) and (b) not mounting/holding what isn't seen (see occlusion,
next) — not a leak fix. (Churn-leak paths — attach/re-attach, focus-driven WebGL
context recreation #1399 — were not exhausted this pass; the toolkit
`check-yn-disposed.mjs` / `find-retainers.mjs` is staged for a follow-up.)

### Occlusion / off-screen render waste (a new, confirmed cost)

`App.tsx renderCanvasTileBody` mounts every canvas tile with a **hardcoded
`visible={true}`** ("so inactive xterms keep their grid sized correctly"). So
every mounted tile runs its full xterm render pipeline on each output chunk —
even when it is not actually seen. Measured (master-clean, one live producer,
**relative headless CPU only**):

| Producer tile state | Whole-Chrome CPU | GPU-proc |
|---|---:|---:|
| Visible (normal)                    | 54.1% | 37.0% |
| Occluded (opaque overlay, in-layout)| 48.2% | 31.7% |
| Off-viewport (transformed off-screen)| 43.6% | 27.9% |
| `display:none` (leaves layout)      | 23.5% | 14.0% |

An occluded or off-viewport tile keeps ~most of its render cost; only leaving
layout (`display:none`) pauses it (via xterm's RenderService IntersectionObserver
firing on the 0×0 element). The residual ~23% under `display:none` is the
irreducible parse cost — PTY data still arrives and `term.write` parses it into
the buffer regardless of visibility; only paint/composite is saved.

CanvasTile **already computes** the exact signal needed — an `onScreen` memo
(tile rect vs canvas viewport + 200px margin) — but it only gates the aura
animation (`showAura`), **not** rendering. The clean fix reuses that
source-of-truth to also pause paint for off-screen tiles, WITHOUT `display:none`
(which would break grid sizing): pause xterm's render while keeping layout.

**Status: real, non-lossy in principle, but deferred as a rushed patch.** The
saving ceiling is bounded (parse cost stays; Chrome already culls some), the
absolute magnitude is real-GPU-pending, and pausing xterm's render lifecycle is
the precise fragile surface that produced #575/#591/#1399/#1306/#1400. The
perfection standard says: land this as its own change with real-GPU confirmation
and full reveal/resize/WebGL-context-loss lifecycle testing — not as an
overnight bolt-on. Documented here as the highest-value CPU follow-up for
srid's *active multi-tile* sessions.

### #1748 animation freeze is INCOMPLETE — the StatePip gap

`@kolu/solid-statepip` (the merged status indicator used in the terminal title
bar, the Dock rows, and the workspace grid) ships two perpetual `infinite` CSS
animations that **#1748 did not touch**:

- `.statepip-live-ring` — `statepip-spin 3.6s linear infinite`, shown while a
  terminal is moving bytes. Its own CSS calls it *"the old standalone
  live-activity dot, now the indicator's rotating edge"* — i.e. it is the live
  successor of exactly the `LiveActivityDot` #1748 froze. #1748 froze the old
  dot but left this spinning for every live terminal.
- `.statepip-alert-badge` — `statepip-pulse 1.8s ease-in-out infinite`, pulses
  while an unread alert is pending (an idle, perpetual pulse).

So #1748's own goal ("stop state cues from burning CPU") is not fully met: the
primary live cue still spins during every active session, and the alert badge
pulses perpetually while unread. In this harness, freezing the single
`statepip-spin` ring dropped a live producer's GPU-proc from ~31% to ~15%
(headless, relative) — because a perpetual composited animation keeps the
compositor producing begin-frames. On real vsync hardware this is bounded to
60–120 begin-frames/s (still a real battery cost during long sessions), which is
the open efficiency question from the harness note. A `prefers-reduced-motion`
block already renders both static, so a static-by-default variant is a
precedented, non-lossy visual (colour/shape carry the state; only rotation is
lost) — the SAME trade #1748 already makes for the dot.

### Recommendation on #1748

- **Merge the memory half** (scrollback 50k→10k, WebGL 8→6). It bounds the
  dominant browser-memory bucket (xterm line buffers) for long-running live
  agents — ~49 MiB per terminal that streams past 10k. Flag the scrollback-depth
  trade in the PR body, but note the honest nuance: the client only ever holds
  >10k lines for **live-attached** output, and that surplus is **reset to the
  10k mirror snapshot on any reconnect/host-switch** — so the functionality loss
  is smaller than the constant change suggests.
- **Merge the animation half** (aura / agent-indicator / live-dot / cursor
  freeze) as battery-hygiene — it is correct and harmless — but understand it is
  **repro-scoped**: it eliminates idle-canvas CPU (real when agents are done and
  tiles wait), and near-nothing in an *active* session where live-output repaint
  dominates. It is NOT the fix for srid's live-session drain, and its headline
  121%→0.5% is inflated by the headless free-running compositor.
- **Complete it**: #1748 missed `@kolu/solid-statepip`'s live-ring + alert-badge
  (this pass's separate, droppable commit). Without that, #1748's own goal
  ("stop state cues from burning CPU") is not met for the primary live cue.
- **The real target for srid's active sessions is live terminal-output repaint**
  — inherent xterm WebGL rendering, not a kolu reactive bug (the activity signal
  is edge-triggered, verified). The two levers that touch it are the memory cap
  (fewer buffered lines) and the **occlusion / off-screen render-gate**
  (recommendation-only here; see its section — real but real-GPU-pending and in
  the #575/#1399 fragile zone).

Net: **do not supersede #1748 — merge both halves with the caveats above, add the
StatePip completion, and open the occlusion render-gate as the next CPU change.**

### Morning confirmation — the ONE real-GPU run for srid (Mac, headful)

Every CPU number in this pass is headless/relative (software raster + free-running
compositor). This is the single headful run that pins the one number a headless
harness can't: **does freezing idle animations actually move CPU on real vsync
hardware, under a LIVE scene?** Run on the Mac, read **Chrome Task Manager**
(the surface srid originally reported from).

```sh
# 1. Run THIS branch (StatePip static) isolated, never production:
KOLU_STATE_DIR="$(mktemp -d)" \
KOLU_PADI_STATE_DIR="$KOLU_STATE_DIR/padi" \
nix run 'github:juspay/kolu/<THIS-BRANCH>' -- --host 127.0.0.1 --port 45999
# open http://127.0.0.1:45999 in the PWA/Chrome.

# 2. Build the live scene: 6+ terminals; in 2-3 of them run a steady producer:
#      while true; do echo "live $(date +%s.%N)"; sleep 0.05; done
#    Leave one agent (claude/codex) at its waiting prompt (aura), code panel open,
#    one terminal focused.

# 3. Chrome ⋮ → More tools → Task Manager. Record for the "Kolu" tab row:
#      CPU %   and   GPU Memory.
```

Read off, in order:

1. **CPU with the live producers streaming.** This is srid's real steady cost.
   Expectation from this pass: dominated by output repaint, in the tens of % —
   NOT ~0.5%.
2. **Toggle macOS System Settings → Accessibility → Display → Reduce Motion ON**,
   leave the producers streaming, re-read CPU. `prefers-reduced-motion` freezes
   every remaining CSS animation (the same effect #1748 ships by default).
   - If CPU **barely moves** → confirms the adjudication: idle-animation freezing
     is not srid's fix; the live-output repaint is the cost.
   - If CPU **drops materially** → the headless free-run inflated the animation
     share less than argued; re-open the animation half as a bigger lever.
3. **GPU Memory** with vs without the deep live buffers — the memory-half check
   is heap-confirmed already; this is just the Task-Manager cross-read against
   the ~1.4 GB symptom.

Compare against `nix run 'github:juspay/kolu/master'` under the identical scene
for the build-to-build delta if a second data point is wanted.

### StatePip freeze — measured (built artifact, headless/relative)

Built this branch and verified the change engages: on a live scene
`document.getAnimations({subtree:true})` drops **1 → 0** (the `statepip-spin`
ring), while the `.statepip-live-ring` element stays in the DOM (the static green
marker is preserved — information intact).

Effect is **repro-scoped, exactly like #1748's own auras** — the same
same-instance toggle told the story twice:

- **Moderate/idle output**: freezing the single `statepip-spin` dropped a live
  producer's GPU-proc **30.8% → 14.8%** (the perpetual animation was the main
  thing waking the headless compositor).
- **Heavy output**: with a producer streaming at full rate, static vs
  animation-injected was **421.1% vs 420.8%** whole-Chrome CPU — **identical**;
  the output raster dominates and the animation's fixed cost vanishes into it.

So the StatePip freeze is a battery-hygiene completion of #1748 (lets the
compositor sleep when a workspace is otherwise quiet), not a lever on srid's
active-session cost — the same honest verdict this whole pass reaches for the
animation half. Real-GPU magnitude pending (see Morning confirmation).

_(Absolute GPU-proc CPU here — 400%+ under one fast producer — is the headless
software-rasterizer, scene- and rate-dependent; it is why this pass keeps
absolute CPU out of every recommendation and reports only same-instance,
one-variable deltas.)_
