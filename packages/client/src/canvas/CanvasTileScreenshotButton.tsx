/** Camera button for canvas tile chrome — lives here rather than inline in
 *  App.tsx so the render-prop call site stays readable. Color inherits from
 *  the tile title bar's `--color-fg-3` CSS variable. */

import type { Component } from "solid-js";
import { CameraIcon } from "../ui/Icons";

const CanvasTileScreenshotButton: Component<{ onClick: () => void }> = (
  props,
) => (
  <button
    class="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20"
    style={{ color: "var(--color-fg-3)" }}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.stopPropagation();
      props.onClick();
    }}
    title="Copy screenshot to clipboard"
    data-testid="canvas-tile-screenshot"
  >
    <CameraIcon />
  </button>
);

export default CanvasTileScreenshotButton;
