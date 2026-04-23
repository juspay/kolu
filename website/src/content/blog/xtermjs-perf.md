---
title: "The leak that wasn't in any Context"
description: "One afternoon, two xterm.js contributions, and a reminder that proxy metrics can be wrong by three orders of magnitude."
pubDate: 2026-04-18
author: "Sridhar Ratnakumar"
---

_One afternoon, two xterm.js contributions, and a reminder that proxy
metrics can be wrong by three orders of magnitude._

[Kolu](https://github.com/juspay/kolu) is a terminal-native cockpit for
coding agents — `claude`, `opencode`, whatever ships next week.
The terminal is the universal interface: every pane is a real
[xterm.js](https://xtermjs.org/) in the browser, connected over
WebSocket to a PTY on the server, and Kolu watches what you already
do (the repos you `cd` into, the agents you run) to populate its
UI. No agent adapters, no preferences pane. Run a new agent once
and it appears in the command palette the next time you need it.

Yesterday I shipped [canvas mode](https://x.com/sridca/status/2044953014100726221):
instead of stacking terminals in a sidebar, you drag them around a
freeform 2D canvas like desktop windows. Cute demo, popular feature,
and — within hours of me updating the always-on Kolu instance on my
headless dev box — the thing that made the tab footprint climb to
1.2 GB.

Toggle canvas-on, toggle canvas-off, repeat thirty times. Chrome Task
Manager kept climbing. Stop toggling, leave the tab alone, come back
in an hour: still 1.2 GB. Close the tab. Reopen. 300 MB again.
Toggle thirty times. 1.2 GB.

This is the story of finding the leak, told honestly: the two
wrong hours, the one good diff, the one-line fix, and the two small
patches I upstreamed to xterm.js along the way. I drove; [Claude
Code](https://claude.com/claude-code) did the agent-side work.

## First pass: the bus-stop fix

<div class="tweet-embed">
<blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><p lang="en" dir="ltr">Debugging Kolu memory leak in Kolu itself on iPhone whilst waiting at the bus stop. <a href="https://t.co/ysFvgmHZoS">pic.twitter.com/ysFvgmHZoS</a></p>&mdash; Sridhar Ratnakumar (@sridca) <a href="https://twitter.com/sridca/status/2045164268341895434?ref_src=twsrc%5Etfw">April 17, 2026</a></blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</div>

The first pass at the leak happened earlier that day on the bus to
the swimming pool, then again checking it on the way back,
typing instructions to Claude Code on my phone and watching retainer
walks come back between stops. That pass found a
dispose-registration gap inside xterm itself: two `MutableDisposable`
fields in `RenderService` and `WebglRenderer` were declared with `=
new MutableDisposable()` but never wrapped in `this._register(...)`.
Without that registration, xterm's `Disposable` base class never
disposed them on teardown, so a `setInterval` for the cursor blink
and a debounced resize task kept ticking past `terminal.dispose()`.
Six lines of source. [xtermjs/xterm.js#5817](https://github.com/xtermjs/xterm.js/pull/5817).

Deploy. Chrome Task Manager, GPU Memory column: dropped from steady-
climbing to flat. Memory Footprint column: unchanged. GPU was a
symptom of its own leak, not the big one.

## The wrong turn

Kolu uses [SolidJS](https://www.solidjs.com/), which tracks
reactivity through [`system/Context`](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots#system-context)
objects — V8's name for the block of memory that holds a closure's
captured variables. If a component's scope fails to clean up on
unmount, its `Context` lingers, and everything that scope closes
over lingers with it. Classic retention.

Claude took the usual first steps. Open Chrome DevTools → Memory tab.
Take a [heap snapshot](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots)
before, thirty toggles, snapshot after. Look at instance count growth
per class. Tens of thousands of new `system/Context` and `closure`
objects between the two snapshots. Chase the retainer chains. Find
the usual SolidJS-shaped culprits:

- Inline JSX event handlers (`<div onClick={() => terminal.focus()}>`)
  that share a V8 lexical scope with everything else in the component
  body. One closure in that scope captures something heavy; the whole
  scope gets pinned.
- Third-party component libraries (`@corvu/resizable`,
  `@thisbeyond/solid-dnd`) that register internal contexts and don't
  always tear them down cleanly.

Six commits landed on [a branch](https://github.com/juspay/kolu/pull/614)
over the afternoon. Claude replaced the two libraries with 200 lines
of custom code. Delegated every inline handler to the parent.
`Context` count per 30-toggle run went from +11,025 down to +1,208.
An 89% reduction. Claude wrote the PR, drew a mermaid graph of the
staircase. I deployed to my dev box.

Chrome Task Manager showed no change. Zero. Identical to before.

## What I was actually measuring

Chrome's [Task Manager](https://developer.chrome.com/docs/devtools/memory-problems#monitor_memory_use_in_realtime_with_the_chrome_task_manager)
has three columns that matter for a tab: `JavaScript Memory`,
`GPU Memory`, and `Memory Footprint`. The first two are what they
sound like. `Memory Footprint` is the one that matters: the total
resident size the operating system assigns to the tab's renderer
process. It's an aggregate — it rolls up the JS heap, the GPU
textures, Chrome's per-renderer baseline (~100-150 MB), V8's code
cache, and a category that isn't called out as its own column but
turned out to be the big one here:

**Native-side state backing the DOM and typed-array objects.** SVG
element attributes, detached canvases, and — the one that mattered —
[`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer)
backing stores. An `ArrayBuffer` is the raw byte block that a typed
array (a `Uint32Array` etc.) is a typed view of; it lives outside
what [`performance.memory`](https://web.dev/articles/monitor-total-page-memory-usage)
can see. Kilobytes of typed-array object metadata in the JS heap can
correspond to megabytes of `ArrayBuffer` bytes in the native heap.
The JS-side instance count tells you how many arrays exist; the
aggregate `Memory Footprint` tells you how much memory they actually
cost.

`system/Context` count is a JS-heap metric. Reducing it by 89% is
meaningful if the leak is there. It's invisible if the leak is in
native-side `ArrayBuffer` bytes.

The leak was in native-side `ArrayBuffer` bytes.

## The one-line fix that took hours to find

I told Claude to throw the PR away and start over with a different
analyzer: aggregate `self_size` bytes per class across a snapshot
pair, sort by byte growth. Five minutes of code, one line of output:

```
  dBytes        dCount    Class
  220,963,752   175,594   native:system/JSArrayBufferData
   10,535,640   175,594   object:Uint32Array
```

220 megabytes. 175,594 retained [`Uint32Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint32Array)s
per 30 toggles.

The number factored obviously: 30 toggles × 7 terminals × ~830
scrollback lines per terminal = 174,300. Every `xterm.js BufferLine`
of every `Terminal` instance that had ever existed during those
thirty toggles was still in memory. `terminal.dispose()` had fired
for every one. The buffers were supposed to be gone.

Claude then walked BFS from the GC root to every retained
`Uint32Array`. Every one of the 175,594 instances came back with the
same retainer chain:

```
Window.IntersectionObserver   (native browser registry)
  → callback closure
  → RenderService              (this)
  → _bufferService.buffers
  → BufferLine
  → Uint32Array
```

xterm's [`RenderService`](https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/RenderService.ts)
wires an [`IntersectionObserver`](https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver)
(a browser API for "tell me when this element scrolls into or out of
view") to the terminal's DOM element so it can pause rendering when
the terminal isn't visible. Perfectly reasonable. The callback is an
arrow function — it closes over `this` (the `RenderService` with its
whole service graph). On dispose, xterm calls `observer.disconnect()`.
In a clean environment, that releases the callback and the service
graph can GC.

In my environment, the callback stayed alive. Maybe a Chrome
extension monkey-patched `window.IntersectionObserver`. Maybe DevTools
was instrumenting it. I don't know. I spent some time trying to find
out and gave up. The heap snapshot told me one thing that mattered:
the callback was still in the native registry, holding `this`.

You can break this chain defensively without knowing who's holding
what. `WeakRef` a reference that tells the GC "hold this only if
someone else is":

```diff
 if ('IntersectionObserver' in w) {
-  const observer = new w.IntersectionObserver(
-    e => this._handleIntersectionChange(e[e.length - 1]),
-    { threshold: 0 }
-  );
+  const weakSelf = new WeakRef(this);
+  const observer = new w.IntersectionObserver(
+    e => weakSelf.deref()?._handleIntersectionChange(e[e.length - 1]),
+    { threshold: 0 }
+  );
   observer.observe(screenElement);
   this._observerDisposable.value = toDisposable(() => observer.disconnect());
 }
```

While the `RenderService` has live strong references (which it does,
as long as the terminal is on screen), `weakSelf.deref()` returns it
and the handler runs exactly as before. When `terminal.dispose()`
drops the strong references, `deref()` starts returning `undefined`
and the entire `BufferService → BufferLine → Uint32Array` graph
becomes collectable — which is what `disconnect()` was supposed to
guarantee but doesn't, in practice.

Deploy. Fresh tab, thirty toggles, quiet session: **Task Manager
footprint flat.** The original +367 MB/30-toggles regression dropped
to zero.

## The xterm.js side

Two upstream contributions fell out of the day's work:

- [xtermjs/xterm.js#5817](https://github.com/xtermjs/xterm.js/pull/5817)
  — the bus-stop patch above. Register the two `MutableDisposable`
  fields. Six lines of source. Dropped the GPU-memory leak.
- [xtermjs/xterm.js#5821](https://github.com/xtermjs/xterm.js/pull/5821)
  — the `WeakRef` patch. One line of real code plus a comment
  explaining why. Dropped the Memory-Footprint leak.

Both patches look laughably small. Both took hours of measurement,
retainer-walking, and wrong turns to find. That's the shape of this
kind of work; the ratio of code-volume to investigation-time is
always roughly zero.

I consume them via the juspay/xterm.js fork and `pnpm.overrides`,
stacked as a Kolu-consumption branch:

```json
"@xterm/xterm": "github:juspay/xterm.js#fix/kolu-xterm-fixes-built"
```

When upstream merges, the override collapses to a plain version bump.

## What I'd tell past-me

Three things to internalise if you came here from a backend or
systems-programming background and web-frontend memory tooling feels
murky:

**The browser's Task Manager is the only ground truth.** Everything
else — `performance.memory.usedJSHeapSize`, heap snapshot class
counts, anything derived from the JS-side heap alone — is a proxy for
what the tab actually uses. Proxies can drift from the truth by
orders of magnitude, because the truth includes native DOM state,
GPU buffers, and compositor layers that JS introspection can't reach.
Before claiming a fix works: fresh tab, Task Manager baseline,
reproducer, Task Manager after. No exceptions.

**Sort heap diffs by bytes, not by instance count.** A 220 MB leak
across 175,594 `Uint32Array` instances dominates any amount of churn
in `system/Context` or `closure` counts. The biggest class by bytes
almost always holds everything else via its closure chain; fixing
something smaller first gets you zero footprint improvement.

**`.disconnect()`, `.dispose()`, and `removeEventListener()` are
best-effort in the presence of browser extensions, DevTools, and
native registries.** If a callback closes over heavy state and lives
past its owner, the graph stays alive. `WeakRef` is cheap insurance:
one `.deref()?.` in the callback path, zero behavioural change when
the reference is live, clean GC when it isn't. Use it defensively on
any callback you hand to `IntersectionObserver`, `MutationObserver`,
`ResizeObserver`, or `EventTarget.addEventListener`.

The commit hash is
[c9794db](https://github.com/juspay/kolu/pull/617). My always-on Kolu
tab sits at 300 MB now, and stays there.

The full investigation history — including the wrong turns I glossed
over here — lives in Kolu's repo alongside the tools that did the
work:

- [`docs/perf-investigations/memory-learnings.md`](https://github.com/juspay/kolu/blob/master/docs/perf-investigations/memory-learnings.md)
  — three chapters of leak-hunts, with all the failed theories
  preserved.
- [`.apm/skills/perf-diagnose/SKILL.md`](https://github.com/juspay/kolu/blob/master/.apm/skills/perf-diagnose/SKILL.md)
  — the runbook future Claude Code sessions will read before they
  re-tread the proxy-metric path I spent the afternoon on.
- [`docs/perf-investigations/scripts/`](https://github.com/juspay/kolu/tree/master/docs/perf-investigations/scripts)
  — the heap-snapshot analyzers, including the byte-delta diff that
  named the leak in one line.
