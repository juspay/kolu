/** Identity watermark — top-left of the canvas surface, just below the
 *  chrome bar so it doesn't collide with the logo. Painted on both the
 *  populated canvas (inside TerminalCanvas) and the empty state (inside
 *  the empty canvas-container) so the workspace identity is always
 *  visible. Outside any pan/zoom transform — reads as a fixed mark on
 *  the surface, not a tile. */

import type { Component } from "solid-js";

const CanvasWatermark: Component<{ text: string }> = (props) => (
  <div
    data-testid="canvas-watermark"
    aria-hidden="true"
    class="absolute top-12 left-3 z-0 font-mono text-[0.7rem] tracking-wide text-fg-3/40 pointer-events-none select-none"
  >
    {props.text}
  </div>
);

export default CanvasWatermark;
