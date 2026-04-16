/** Figma-style zoom toolbar for the canvas viewport.
 *  [zoom-to-fit] | [−] [percentage] [+]
 *  Reads zoom state from the useCanvasViewport singleton. */

import type { Component } from "solid-js";
import { ZoomToFitIcon } from "../ui/Icons";
import { SHORTCUTS, formatKeybind } from "../input/keyboard";
import { useCanvasViewport } from "./useCanvasViewport";

const CanvasZoomToolbar: Component<{
  onFitAll: () => void;
}> = (props) => {
  const viewport = useCanvasViewport();

  return (
    <div class="absolute bottom-4 left-4 z-20 flex items-center gap-px rounded-lg bg-surface-2/80 backdrop-blur-sm border border-edge/40 overflow-hidden">
      <button
        class="flex items-center justify-center w-8 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer"
        title={`Zoom to fit (${formatKeybind(SHORTCUTS.canvasFitAll.keybind)})`}
        onClick={() => props.onFitAll()}
      >
        <ZoomToFitIcon class="w-3.5 h-3.5" />
      </button>
      <div class="w-px h-5 bg-edge/30" />
      <button
        class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
        title="Zoom out"
        onClick={() => viewport.zoomOut()}
      >
        −
      </button>
      <button
        class="flex items-center justify-center min-w-[3rem] h-8 px-1 text-fg-2 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-xs tabular-nums"
        title="Reset to 100%"
        onClick={() => viewport.resetZoom()}
      >
        {Math.round(viewport.zoom() * 100)}%
      </button>
      <button
        class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
        title="Zoom in"
        onClick={() => viewport.zoomIn()}
      >
        +
      </button>
    </div>
  );
};

export default CanvasZoomToolbar;
