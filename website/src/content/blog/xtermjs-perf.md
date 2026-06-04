---
title: "Measuring the Wrong Thing"
description: "One afternoon, two xterm.js contributions, and a reminder that proxy metrics can be wrong by three orders of magnitude."
pubDate: 2026-04-18
author: "Sridhar Ratnakumar"
---

[Kolu](https://github.com/juspay/kolu) is a terminal-native cockpit for coding agents — `claude`, `opencode`, whatever ships next week. The terminal is the universal interface: every pane is a real [xterm.js](https://xtermjs.org/) in the browser, wired over a WebSocket to a PTY on the server, and Kolu just watches what you already do — the repos you `cd` into, the agents you run — to build its UI. No agent adapters, no preferences pane. Run a new agent once and it shows up in the command palette the next time you want it.

Yesterday I shipped [canvas mode](https://x.com/sridca/status/2044953014100726221): instead of stacking terminals in a sidebar, you drag them around a freeform 2D canvas, like windows on a desk. Cute demo, people liked it, and — within hours of it going live on the always-on Kolu instance on my headless dev box — the thing that drove the tab to 1.2 GB.

Toggle canvas on, toggle it off, thirty times. Chrome's Task Manager kept climbing. Stop, leave the tab alone, come back an hour later: still 1.2 GB. Close the tab, reopen it: 300 MB. Toggle thirty times: 1.2 GB again.

This is the story of finding that leak, told honestly — the two wrong hours, the one good diff, the one-line fix, and the two small patches I sent upstream to xterm.js on the way. I drove; [Claude Code](https://claude.com/claude-code) did the agent-side work.

## The bus-stop fix

<div class="tweet-embed">
<blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><p lang="en" dir="ltr">Debugging Kolu memory leak in Kolu itself on iPhone whilst waiting at the bus stop. <a href="https://t.co/ysFvgmHZoS">pic.twitter.com/ysFvgmHZoS</a></p>&mdash; Sridhar Ratnakumar (@sridca) <a href="https://twitter.com/sridca/status/2045164268341895434?ref_src=twsrc%5Etfw">April 17, 2026</a></blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</div>

The first crack at it happened on the bus to the swimming pool, and again on the way back — typing instructions to Claude Code on my phone and watching retainer walks come back between stops. That pass found a real bug, just not the one I was chasing. Two `MutableDisposable` fields in xterm — one in `RenderService`, one in `WebglRenderer` — were created with `= new MutableDisposable()` but never wrapped in `this._register(...)`. Without that registration, xterm's `Disposable` base class never tore them down, so a `setInterval` for the cursor blink and a debounced resize task kept ticking long after `terminal.dispose()`. Six lines of source: [xtermjs/xterm.js#5817](https://github.com/xtermjs/xterm.js/pull/5817).

Deploy. Chrome's Task Manager, GPU Memory column: the steady climb went flat. Memory Footprint column: unchanged. So the GPU thing was a leak — its own small leak — but not the one eating the gigabyte. **I'd fixed a symptom.**

## The wrong turn

Kolu uses [SolidJS](https://www.solidjs.com/), which tracks reactivity through [`system/Context`](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots#system-context) objects — V8's name for the block of memory that holds a closure's captured variables. If a component's scope doesn't clean up on unmount, its `Context` hangs around, and everything that scope closed over hangs around with it. _Retention_, the textbook kind.

So Claude took the obvious first steps. Chrome DevTools, Memory tab. [Heap snapshot](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots) before, thirty toggles, snapshot after. Diff the instance counts per class. Tens of thousands of new `system/Context` and `closure` objects between the two. Chase the retainer chains. Find exactly the SolidJS-shaped culprits you'd expect:

- Inline JSX handlers (`<div onClick={() => terminal.focus()}>`) that share one V8 lexical scope with the whole component body. One closure in that scope captures something heavy, and the entire scope gets pinned.
- Component libraries (`@corvu/resizable`, `@thisbeyond/solid-dnd`) that register internal contexts and don't always tear them down cleanly.

Six commits landed on [a branch](https://github.com/juspay/kolu/pull/614) over the afternoon. Claude swapped both libraries for 200 lines of our own code, delegated every inline handler to the parent, and got the `Context` count per 30-toggle run from +11,025 down to +1,208. An 89% cut. It wrote the PR and drew a tidy mermaid graph of the staircase coming down. I deployed.

Chrome's Task Manager showed no change. None. **The number I'd spent the afternoon cutting wasn't the number that mattered.**

## What I was actually measuring

Chrome's [Task Manager](https://developer.chrome.com/docs/devtools/memory-problems#monitor_memory_use_in_realtime_with_the_chrome_task_manager) shows three columns for a tab: `JavaScript Memory`, `GPU Memory`, and `Memory Footprint`. The first two are what they sound like. `Memory Footprint` is the one that counts — the total resident size the operating system hands the tab's renderer process. It rolls everything up: the JS heap, the GPU textures, Chrome's per-renderer baseline (~100–150 MB), V8's code cache, and one more thing that gets no column of its own and turned out to be the whole story.

_Native-side state backing the DOM and typed-array objects._ SVG attributes, detached canvases, and — the one that mattered — [`ArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer) backing stores. An `ArrayBuffer` is the raw block of bytes a typed array (a `Uint32Array`, say) is a view onto, and it lives outside what [`performance.memory`](https://web.dev/articles/monitor-total-page-memory-usage) can see. A few kilobytes of typed-array metadata in the JS heap can stand for megabytes of `ArrayBuffer` bytes in the native heap. The JS-side count tells you how many arrays exist. The aggregate footprint tells you what they cost.

`system/Context` count is a JS-heap number. Cutting it by 89% means something if that's where the leak is. It means nothing if the leak is in native `ArrayBuffer` bytes.

**The leak was in native `ArrayBuffer` bytes.**

## The one-line fix that took hours to find

I told Claude to throw the PR away and start over, this time with a different analyzer: sum `self_size` bytes per class across a snapshot pair, sort by byte growth. Five minutes of code, one line of output worth reading:

```
  dBytes        dCount    Class
  220,963,752   175,594   native:system/JSArrayBufferData
   10,535,640   175,594   object:Uint32Array
```

220 megabytes. 175,594 retained [`Uint32Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint32Array)s per thirty toggles.

The number factored on sight: 30 toggles × 7 terminals × ~830 scrollback lines each = 174,300. Every `xterm.js BufferLine` of every `Terminal` that had existed during those thirty toggles was still in memory. `terminal.dispose()` had fired on every one of them. The buffers were supposed to be gone.

So Claude walked BFS from the GC root out to each retained `Uint32Array`. All 175,594 came back with the same chain:

```
Window.IntersectionObserver   (native browser registry)
  → callback closure
  → RenderService              (this)
  → _bufferService.buffers
  → BufferLine
  → Uint32Array
```

xterm's [`RenderService`](https://github.com/xtermjs/xterm.js/blob/master/src/browser/services/RenderService.ts) hangs an [`IntersectionObserver`](https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver) — the browser API for "tell me when this element scrolls into or out of view" — on the terminal's DOM node, so it can stop rendering when the terminal isn't visible. Perfectly reasonable. But the callback is an arrow function, so it closes over `this`: the whole `RenderService` with its entire service graph. On dispose, xterm calls `observer.disconnect()`, and in a clean browser that frees the callback and the graph can be collected.

In my browser it didn't. Maybe an extension had monkey-patched `window.IntersectionObserver`. Maybe DevTools was instrumenting it. I spent a while trying to find out and gave up, because the snapshot had already told me the one thing I needed: the callback was still sitting in the native registry, holding `this`.

And you can cut that chain without ever learning who's holding it. `WeakRef` the back-reference — tell the GC to keep `this` only if someone else is already keeping it:

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

While the `RenderService` has live strong references — which it does the whole time the terminal is on screen — `weakSelf.deref()` hands it back and the handler runs exactly as before. When `terminal.dispose()` drops those references, `deref()` starts returning `undefined`, and the whole `BufferService → BufferLine → Uint32Array` graph becomes collectable. Which is what `disconnect()` was supposed to guarantee, and didn't.

Deploy. Fresh tab, thirty toggles, quiet session: **the footprint stayed flat.** The +367 MB-per-30-toggles regression went to zero.

## The xterm.js side

Two upstream patches fell out of the day:

- [xtermjs/xterm.js#5817](https://github.com/xtermjs/xterm.js/pull/5817) — the bus-stop patch. Register the two `MutableDisposable` fields. Six lines of source. Killed the GPU-memory leak.
- [xtermjs/xterm.js#5821](https://github.com/xtermjs/xterm.js/pull/5821) — the `WeakRef` patch. One line of real code plus a comment saying why. Killed the Memory-Footprint leak.

Both look laughably small. Both took hours of measuring, retainer-walking, and wrong turns to find. **That's the shape of this work: the ratio of code written to time spent is about zero.**

While they were unreleased I pulled them in through a `juspay/xterm.js` fork pinned in `pnpm.overrides`. #5817 has since merged upstream, and #5821 was closed in favor of the equivalent [#5831](https://github.com/xtermjs/xterm.js/pull/5831) (clear the observer reference on dispose); both shipped in the upstream `6.1.0-beta` line, so the override is now a plain version pin against the auto-published betas built from `xtermjs/xterm.js@master`:

```json
"@xterm/xterm": "6.1.0-beta.225",
"@xterm/addon-webgl": "0.20.0-beta.224"
```

## What I'd tell past-me

Three things, if you came to web-frontend memory work from a backend or systems background and the tooling feels murky.

The browser's Task Manager is the only ground truth. Everything else — `performance.memory.usedJSHeapSize`, heap-snapshot class counts, anything read off the JS heap alone — is a proxy for what the tab actually uses, and a proxy can be wrong by orders of magnitude, because the truth includes native DOM state, GPU buffers, and compositor layers that JS introspection can't reach. Before you claim a fix works: fresh tab, Task Manager baseline, reproducer, Task Manager after. **No exceptions.**

Sort heap diffs by bytes, not by instance count. A 220 MB leak across 175,594 `Uint32Array`s drowns out any amount of churn in `system/Context` or `closure` counts. The biggest class by bytes is almost always holding everything else through its closure chain, so fix it first. **Fix something smaller and you get zero footprint back.**

`.disconnect()`, `.dispose()`, and `removeEventListener()` are best-effort. In the presence of browser extensions, DevTools, and native registries, a callback that closes over heavy state and outlives its owner keeps the whole graph alive. `WeakRef` is cheap insurance: one `.deref()?.` in the callback path, no behavior change while the reference is live, clean collection when it isn't. **Use it on anything you hand to `IntersectionObserver`, `MutationObserver`, `ResizeObserver`, or `EventTarget.addEventListener`.**

The fix is [c9794db](https://github.com/juspay/kolu/pull/617). My always-on Kolu tab sits at 300 MB now, and stays there.

The full investigation history — including the wrong turns I glossed over here — lives in Kolu's repo alongside the tools that did the work:

- [`docs/perf-investigations/memory-learnings.md`](https://github.com/juspay/kolu/blob/master/docs/perf-investigations/memory-learnings.md) — three chapters of leak-hunts, with all the failed theories preserved.
- [`.apm/skills/perf-diagnose/SKILL.md`](https://github.com/juspay/kolu/blob/master/.apm/skills/perf-diagnose/SKILL.md) — the runbook future Claude Code sessions read before they re-tread the proxy-metric path I spent the afternoon on.
- [`docs/perf-investigations/scripts/`](https://github.com/juspay/kolu/tree/master/docs/perf-investigations/scripts) — the heap-snapshot analyzers, including the byte-delta diff that named the leak in one line.
