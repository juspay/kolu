# #1399 decisive test — run on the real W6800 / GNOME-Wayland box

Goal: determine whether kolu's P2/P4 geometry paths churn **under your actual
compositor regime** (AMD Navi 21, Mutter 49 Wayland, Mesa 25.2.6, fractional
scaling) — the one condition never tested. Every prior measurement (mine on a
fresh box, the maintainer's in #1308) showed **0 churn**; this confirms or
falsifies that on your hardware.

> ⚠️ A real amdgpu MODE1 reset crashes your entire Wayland session. **Save all
> work first.** Arm the abort-watch (Step 0) BEFORE anything else and abort the
> instant a stop-rule string appears. Never run synthetic GPU stress.

## Step 0 — arm the abort-watch FIRST (separate terminal, leave visible)

```sh
# Kernel fault watch — PRIMARY stop rule. Abort the whole test the instant ANY
# line prints here:  page fault | ring ... timeout | GPU reset begin | MODE1 |
# VRAM is lost | context is lost   (fault-to-reset is ~10s)
sudo dmesg -w | grep --line-buffered -iE 'page fault|ring .*timeout|gpu reset|MODE1|VRAM is lost|context is lost'
```

```sh
# In another terminal: identify the discrete W6800 (crash bus was 0000:3d:00.0)
for c in /sys/class/drm/card?; do printf '%s -> ' "$c"; grep PCI_SLOT_NAME "$c/device/uevent"; done
# Then watch its VRAM + busy (replace cardN). SECONDARY stop rule: abort if
# mem_info_vram_used climbs steeply toward total, or gpu_busy_percent pins at 100
# while ProduceSkia errors appear.
watch -n1 'cat /sys/class/drm/cardN/device/mem_info_vram_used /sys/class/drm/cardN/device/gpu_busy_percent'
```

```sh
# Compositor signal watch: the #1308/#1399 pre-crash Mutter assertion
journalctl --user -f -o cat | grep --line-buffered -i 'stack_position'
```

## Step 1 — launch kolu and arm page telemetry

Open kolu in the same Chromium you normally use. Open DevTools (F12) → Console,
paste this once:

```js
(() => {
  const R = (window.__k1399 = { appH: [], vv: [], ro: 0, start: performance.now() });
  const sp = CSSStyleDeclaration.prototype.setProperty;            // P4: count --app-h writes
  if (!sp.__k1399) {
    CSSStyleDeclaration.prototype.setProperty = function (n, v, p) {
      if (n === '--app-h') R.appH.push({ t: Math.round(performance.now()), v: String(v) });
      return sp.call(this, n, v, p);
    };
    CSSStyleDeclaration.prototype.setProperty.__k1399 = true;
  }
  window.visualViewport?.addEventListener('resize', () =>          // P4 trigger frequency
    R.vv.push({ t: Math.round(performance.now()), h: visualViewport.height, dpr: devicePixelRatio }));
  const RO = window.ResizeObserver;                                // P2: wrap RO ctor
  window.ResizeObserver = class extends RO { constructor(cb){ super((e,o)=>{ R.ro+=e.length; return cb(e,o); }); } };
  window.k1399report = () => ({
    seconds: Math.round((performance.now() - R.start) / 1000),
    appH_writes: R.appH.length,
    appH_distinct: [...new Set(R.appH.map(x => x.v))],
    vv_resizes: R.vv.length,
    ro_fires_newTerminals: R.ro,           // counts terminals CREATED after this paste
  });
  console.log('kolu #1399 telemetry armed → call k1399report()');
})();
```

Now create **6–7 terminals** (`Ctrl/Cmd+Enter`) — created *after* the paste, so
their ResizeObservers are wrapped — and start an agent / continuous output in each.
Open **Debug → Diagnostic info** (note WebGL `aliveDetached`, `contextsLost`,
total canvases — the GPU-context-leak signal).

## Step 2 — baseline (idle, 60s)

Sit idle 60s, then run `k1399report()` and note the Diagnostic numbers.
Expectation (from prior measurement): everything ≈ 0 / settled.

## Step 3 — apply the EXTERNAL drivers the prior tests lacked (~30–60s)

While watching the abort terminals:
1. **Continuously drag-resize** the kolu window; cycle **maximize ⇄ restore** for ~30s.
2. **Flap the display scale** in GNOME Settings (e.g. 100% ⇄ 125% ⇄ 150%) a few times.
3. **Focus ⇄ Canvas mode toggle ×30**, then a **pan/zoom transform storm** on the canvas.

Run `k1399report()` again; re-check Diagnostic info.

## Step 4 — read the verdict

| Signal | FALSIFIED (P2/P4 not the cause) | REPRODUCED |
|---|---|---|
| `appH_writes` | ≈ number of resizes/scale-changes you did (1:1), settles when you stop | climbs into the hundreds+ and keeps climbing **while idle** |
| `appH_distinct` | a handful of values | a flood of sub-pixel-different values during a *single* steady scale |
| `vv_resizes` | 1:1 with real geometry changes | sustained burst with no input |
| Diagnostic `aliveDetached` / canvas count | returns to baseline on idle | climbs monotonically, never returns |
| Console | clean | `SharedImageManager::ProduceSkia ... non-existent mailbox` (the #1399 signature) |
| `journalctl --user` | clean | `meta_window_set_stack_position_no_sync` assertions |

- **All-FALSIFIED** → P2/P4 are not the driver on your hardware either; the real
  cause is below kolu (Chromium SharedImage / Mutter 49 / Mesa 25.2.6 / Navi 21).
  The `aliveDetached` / `ProduceSkia` / `stack_position` signals say where to dig next.
- **Any REPRODUCED** → capture `k1399report()` + Diagnostic JSON (Copy JSON) +
  the console/journal lines and send them back; the P2/P4 guards then become a
  justified fix (plus escalation to whatever drives the burst).

> One fact that settles most of it on its own: was your 14-minute pre-crash
> window **idle**, or were you resizing windows / changing scale / dragging
> things? Idle → P4 is essentially ruled out. Active geometry changes → the
> external-driver path above is the thing to watch.
