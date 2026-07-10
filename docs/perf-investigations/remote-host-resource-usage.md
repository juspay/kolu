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
