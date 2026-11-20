import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal as XTerm } from "@xterm/xterm";

export interface WebglLifecycleHooks {
  onCanvas?: (canvas: HTMLCanvasElement) => void;
  onBeforeRelease?: () => void;
  onDispose?: () => void;
  onLoadFailed?: (error: unknown) => void;
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
    } catch (error) {
      hooks.onLoadFailed?.(error);
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
    hooks.onBeforeRelease?.();
    webglCanvas
      ?.getContext("webgl2")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    webglCanvas = null;
    w.dispose();
    hooks.onDispose?.();
  }

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
