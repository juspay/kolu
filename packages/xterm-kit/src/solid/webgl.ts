/** Single-owner WebGL addon lifetime + context-loss recovery.
 *
 *  The `WebglAddon`'s lifetime has exactly one safe shape, and getting it wrong
 *  is the #575/#591/#1399 flicker class: a single owner, self-heal on
 *  `webglcontextlost`, and — the part xterm omits — an EXPLICIT
 *  `WEBGL_lose_context.loseContext()` on unload. xterm's `dispose()` removes the
 *  canvas from the DOM but never releases the GPU context, so Chrome keeps it
 *  alive on the detached canvas until GC; rapid focus changes then create
 *  contexts faster than GC frees them and overflow Chrome's ~16-per-tab budget,
 *  at which point it evicts LIVE contexts and every tile flickers. Releasing in
 *  the current microtask keeps the live set within budget.
 *
 *  The gate is an `Accessor<boolean>` by type — WHICH panes deserve a context is
 *  the consumer's budget POLICY (recency budget, a preference toggle, always-on);
 *  this owns only the mechanism. Reconciles reactively: load when the gate turns
 *  true, unload when false. Call synchronously within a reactive owner (the
 *  effect + cleanup register on it). */

import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal as XTerm } from "@xterm/xterm";

/** Optional lifecycle hooks so a consumer can observe the GPU context's
 *  lifetime (kolu wires its #591 `webglTracker` here) WITHOUT the kit knowing
 *  anything about that tracker. Fired in the same order the old inline code did:
 *  `onCanvas` right after the real WebGL canvas is captured, `onBeforeRelease`
 *  immediately before the explicit `loseContext()`, `onDispose` after the addon
 *  is disposed. */
export interface WebglLifecycleHooks {
  onCanvas?: (canvas: HTMLCanvasElement) => void;
  onBeforeRelease?: () => void;
  onDispose?: () => void;
}

/** What `attachWebGL` hands back: the reactive `hasWebgl` fact (single source of
 *  truth — no imperative updater to forget), the texture-atlas clear (a no-op
 *  under the DOM renderer), and the atlas-size probe for diagnostics. */
export interface WebglHandle {
  hasWebgl: () => boolean;
  clearTextureAtlas: () => void;
  textureAtlasSize: () => { w: number; h: number } | null;
}

export function attachWebGL(
  term: XTerm,
  should: () => boolean,
  hooks: WebglLifecycleHooks = {},
): WebglHandle {
  let webgl: WebglAddon | null = null;
  let webglCanvas: HTMLCanvasElement | null = null;
  const [hasWebgl, setHasWebgl] = createSignal(false);

  function load() {
    if (webgl) return;
    try {
      // Single owner of WebglAddon lifetime — any future construction-time flag
      // (e.g. preserveDrawingBuffer for screenshots, #574) must route through
      // here, not a parallel dispose/reconstruct path.
      const w = new WebglAddon();
      w.onContextLoss(() => unload());
      term.loadAddon(w);
      webgl = w;
      // xterm's WebglRenderer constructor appends the LinkRenderLayer's 2D
      // canvas (`class="xterm-link-layer"`) to `.xterm-screen` BEFORE its own
      // WebGL canvas (which has no class). A bare `querySelector(".xterm-screen
      // canvas")` returns the link layer, whose `getContext("webgl2")` is null,
      // silently short-circuiting the `loseContext()` chain below (#591).
      // Exclude the link layer explicitly to grab the real WebGL canvas.
      webglCanvas =
        term.element?.querySelector<HTMLCanvasElement>(
          ".xterm-screen canvas:not(.xterm-link-layer)",
        ) ?? null;
      if (webglCanvas) hooks.onCanvas?.(webglCanvas);
      setHasWebgl(true);
    } catch {
      // WebGL unavailable — xterm's DOM renderer is the fallback.
    }
  }

  function unload() {
    const w = webgl;
    if (!w) return;
    // Null out first: `loseContext()` below fires `webglcontextlost`
    // synchronously, re-entering this via the addon's `onContextLoss` listener;
    // the guard above short-circuits the reentry.
    webgl = null;
    setHasWebgl(false);
    // Explicitly release the GPU context (see the module note). Fire the
    // consumer's pre-release hook first, matching the old inline ordering.
    hooks.onBeforeRelease?.();
    webglCanvas
      ?.getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    webglCanvas = null;
    w.dispose();
    hooks.onDispose?.();
  }

  // Reconcile the context against the gate: load when it enters the budget,
  // unload when it leaves. `defer: true` — the caller drives the initial load
  // once (below), since the effect can't run before the terminal is open.
  createEffect(
    on(
      should,
      (want) => {
        if (want) load();
        else unload();
      },
      { defer: true },
    ),
  );
  // Initial load, now that the terminal is open.
  if (should()) load();
  onCleanup(unload);

  return {
    hasWebgl,
    clearTextureAtlas: () => webgl?.clearTextureAtlas(),
    textureAtlasSize: () => {
      const a = webgl?.textureAtlas;
      return a ? { w: a.width, h: a.height } : null;
    },
  };
}
