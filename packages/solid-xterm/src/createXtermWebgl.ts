/** `createXtermWebgl` — owns the lifetime of xterm's `WebglAddon` for a single
 *  terminal, including the GPU-context release that xterm itself omits.
 *
 *  Why this is its own primitive: Chrome caps WebGL contexts at ~16 per tab.
 *  An app that mounts many xterm tiles (or swaps the renderer on focus) churns
 *  contexts fast, and xterm's `WebglAddon.dispose()` removes the canvas from the
 *  DOM but never calls `WEBGL_lose_context.loseContext()` — so the GPU context
 *  lingers on the detached canvas until GC, overflowing the budget and evicting
 *  *live* contexts (flicker across every tile). This primitive captures the real
 *  WebGL canvas and releases its context synchronously on unload, keeping the
 *  live set at one per terminal.
 *
 *  The renderer *policy* (when WebGL is allowed) stays with the caller — drive
 *  `load`/`unload` from your own effect. The optional `onCanvas`/`onLoseContext`/
 *  `onDispose` hooks let a host attach lifecycle instrumentation (e.g. a
 *  zombie-context ledger) without this library depending on it. */

import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal as XTerm } from "@xterm/xterm";
import { type Accessor, createSignal } from "solid-js";

export interface XtermWebglHooks {
  /** Called once with the real WebGL canvas right after the addon mounts it. */
  onCanvas?: (canvas: HTMLCanvasElement) => void;
  /** Called immediately before `loseContext()` releases the GPU context. */
  onLoseContext?: () => void;
  /** Called after the addon is disposed and the canvas reference is dropped. */
  onDispose?: () => void;
}

export interface XtermWebgl {
  /** `true` while a WebGL context is loaded — drive `data-renderer` etc. */
  hasWebgl: Accessor<boolean>;
  /** Load the WebGL renderer onto `term`. No-op if already loaded. */
  load: (term: XTerm) => void;
  /** Release the WebGL context + addon. No-op if not loaded. */
  unload: () => void;
  /** Clear the WebGL texture atlas (fixes font-rendering corruption, #239). */
  clearTextureAtlas: () => void;
  /** Current texture-atlas dimensions, or null when DOM-rendered. */
  textureAtlas: () => { w: number; h: number } | null;
}

export function createXtermWebgl(hooks: XtermWebglHooks = {}): XtermWebgl {
  let webgl: WebglAddon | null = null;
  let webglCanvas: HTMLCanvasElement | null = null;
  const [hasWebgl, setHasWebgl] = createSignal(false);

  function load(term: XTerm) {
    if (webgl) return;
    try {
      // Single owner of WebglAddon lifetime — any future construction-time
      // flag (e.g. preserveDrawingBuffer for screenshots) must be routed
      // through here, not a parallel dispose/reconstruct path.
      const w = new WebglAddon();
      w.onContextLoss(() => unload());
      term.loadAddon(w);
      webgl = w;
      // Capture the canvas the addon just appended so we can explicitly
      // release its GPU context on unload — see unload().
      //
      // xterm's WebglRenderer constructor appends the LinkRenderLayer's 2D
      // canvas (`class="xterm-link-layer"`) to `.xterm-screen` before it
      // appends its own WebGL canvas (which has no class). A bare
      // `querySelector(".xterm-screen canvas")` returns the first match in
      // document order — the link layer — whose `getContext("webgl2")`
      // returns null, silently short-circuiting the `loseContext()` chain in
      // `unload()`. Exclude the link layer explicitly so we grab the real
      // WebGL canvas.
      webglCanvas =
        term.element?.querySelector<HTMLCanvasElement>(
          ".xterm-screen canvas:not(.xterm-link-layer)",
        ) ?? null;
      if (webglCanvas) hooks.onCanvas?.(webglCanvas);
      setHasWebgl(true);
    } catch {
      // WebGL unavailable — xterm's DOM renderer is the fallback
    }
  }

  function unload() {
    const w = webgl;
    if (!w) return;
    // Null out first: `loseContext()` below fires `webglcontextlost`
    // synchronously, which re-enters this function via the addon's
    // `onContextLoss` listener. The guard above short-circuits the reentry.
    webgl = null;
    setHasWebgl(false);
    // Explicitly release the GPU context. xterm's dispose() removes the
    // canvas from the DOM but does NOT call WEBGL_lose_context.loseContext(),
    // so Chrome keeps the context alive on the detached canvas until GC.
    // Rapid focus changes create contexts faster than GC runs and overflow
    // Chrome's ~16-context-per-tab budget, at which point Chrome starts
    // evicting live contexts — including the focused tile's — producing a
    // flicker across every tile. loseContext() releases GPU memory in the
    // current microtask, keeping the live set at 1.
    hooks.onLoseContext?.();
    webglCanvas
      ?.getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    webglCanvas = null;
    w.dispose();
    hooks.onDispose?.();
  }

  return {
    hasWebgl,
    load,
    unload,
    clearTextureAtlas: () => webgl?.clearTextureAtlas(),
    textureAtlas: () => {
      const a = webgl?.textureAtlas;
      return a ? { w: a.width, h: a.height } : null;
    },
  };
}
