/**
 * WebGL lifecycle for an xterm.js Terminal — load, unload, atlas
 * clear, reactive `has` accessor.
 *
 * Encapsulates two volatility axes that have already bitten Kolu
 * multiple times:
 *
 *  1. **xterm's WebglAddon API and DOM layout.** Construction-time
 *     flags (e.g. `preserveDrawingBuffer` for screenshots, #574),
 *     the link-renderer 2D canvas vs. WebGL canvas selector trap
 *     (xterm appends `.xterm-link-layer` before its own canvas, so
 *     a bare `.xterm-screen canvas` query returns the wrong one and
 *     `WEBGL_lose_context.loseContext()` silently no-ops — #591,
 *     #595), and the addon's onContextLoss recovery.
 *
 *  2. **Chrome's per-tab GPU context budget (~16).** When canvas
 *     mode renders many tiles simultaneously the budget overflows
 *     and Chrome evicts live contexts including the focused tile's
 *     — visible as a flicker across every tile (#575). The fix is
 *     to explicitly release contexts via `WEBGL_lose_context`
 *     before `addon.dispose()`, because addon.dispose() removes the
 *     canvas from the DOM but does NOT call `loseContext()`, so
 *     Chrome keeps the context alive on the detached canvas until
 *     GC. `loseContext()` releases GPU memory in the current
 *     microtask, keeping the live set at 1.
 *
 * Lifecycle hooks (`onCreate`, `onLoseContextCalled`, `onDispose`)
 * exist so the host can observe canvas instances without coupling
 * this framework to a specific debug ledger. Kolu wires them into
 * `webglTracker.ts` (a temporary debug ledger for #591).
 *
 * Re-entrancy: `unload` nulls the local `webgl` ref FIRST because
 * the subsequent `loseContext()` synchronously fires
 * `webglcontextlost`, which re-enters via the addon's
 * `onContextLoss(() => unload())` listener registered in `load`.
 * The early-return guard short-circuits the reentry.
 */

import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal as XTerm } from "@xterm/xterm";
import { createSignal } from "solid-js";

export interface CreateXtermWebglOptions {
  /** Called once per successful `load()` with the WebGL canvas
   *  xterm appended. Use to register the canvas with a lifecycle
   *  observer / debug ledger. */
  onCreate?: (canvas: HTMLCanvasElement) => void;
  /** Called inside `unload()` right before
   *  `WEBGL_lose_context.loseContext()` runs — pair with
   *  `onCreate` for an observer's "loseContext requested" mark. */
  onLoseContextCalled?: () => void;
  /** Called after `addon.dispose()` completes — pair with
   *  `onCreate` for an observer's "disposed" mark. */
  onDispose?: () => void;
}

export interface XtermWebglHandle {
  /** Construct a fresh WebglAddon, attach to the term, register
   *  context-loss recovery. No-op if a context is already attached
   *  or `getTerm()` returns null. Failures are silent — xterm's
   *  DOM renderer is the fallback. */
  load: () => void;
  /** Tear down: release the GPU context explicitly, dispose the
   *  addon, clear local refs. Safe to call when nothing is
   *  loaded. */
  unload: () => void;
  /** Clear the WebGL texture atlas — fixes font-rendering
   *  corruption after some style changes (xterm issue #239). */
  clearTextureAtlas: () => void;
  /** Reactive accessor: true while a WebGL context is attached. */
  has: () => boolean;
  /** Diagnostic probe: current atlas dimensions, null when not
   *  attached or the addon doesn't expose them. */
  atlas: () => { w: number; h: number } | null;
}

export function createXtermWebgl(
  getTerm: () => XTerm | null,
  opts: CreateXtermWebglOptions = {},
): XtermWebglHandle {
  let webgl: WebglAddon | null = null;
  let webglCanvas: HTMLCanvasElement | null = null;
  const [hasWebgl, setHasWebgl] = createSignal(false);

  function load(): void {
    const term = getTerm();
    if (!term || webgl) return;
    try {
      // Single owner of WebglAddon lifetime — any future
      // construction-time flag must be routed through this site,
      // not a parallel dispose/reconstruct path.
      const w = new WebglAddon();
      w.onContextLoss(() => unload());
      term.loadAddon(w);
      webgl = w;
      // xterm's WebglRenderer constructor appends the
      // LinkRenderLayer's 2D canvas (`class="xterm-link-layer"`)
      // to `.xterm-screen` BEFORE its own WebGL canvas (which has
      // no class). A bare `querySelector(".xterm-screen canvas")`
      // returns the first match in document order — the link
      // layer — whose `getContext("webgl2")` returns null,
      // silently short-circuiting the `loseContext()` chain in
      // `unload()`. Exclude the link layer explicitly to grab the
      // real WebGL canvas (diagnosed via Kolu's webglTracker:
      // contextsLost stayed at 0 despite loseContext-called events
      // firing for every disposed canvas, #591).
      webglCanvas =
        term.element?.querySelector<HTMLCanvasElement>(
          ".xterm-screen canvas:not(.xterm-link-layer)",
        ) ?? null;
      if (webglCanvas) opts.onCreate?.(webglCanvas);
      setHasWebgl(true);
    } catch {
      // WebGL unavailable — xterm's DOM renderer is the fallback.
    }
  }

  function unload(): void {
    const w = webgl;
    if (!w) return;
    // Null out FIRST: `loseContext()` below fires
    // `webglcontextlost` synchronously, which re-enters this
    // function via the addon's `onContextLoss` listener
    // registered in `load`. The guard above short-circuits the
    // reentry.
    webgl = null;
    setHasWebgl(false);
    opts.onLoseContextCalled?.();
    webglCanvas
      ?.getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    webglCanvas = null;
    w.dispose();
    opts.onDispose?.();
  }

  function clearTextureAtlas(): void {
    webgl?.clearTextureAtlas();
  }

  function atlas(): { w: number; h: number } | null {
    const a = webgl?.textureAtlas;
    return a ? { w: a.width, h: a.height } : null;
  }

  return {
    load,
    unload,
    clearTextureAtlas,
    has: hasWebgl,
    atlas,
  };
}
