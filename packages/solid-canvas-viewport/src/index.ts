/** `@kolu/solid-canvas-viewport` — Solid-native pan/zoom 2D
 *  canvas viewport. See `./README.md`. */

export {
  type AnimatePanOptions,
  animatePan,
  type Point,
} from "./animatedPan";
export {
  capturePointerGesture,
  type PointerGestureHandlers,
} from "./capturePointerGesture";
export {
  canvasTransformCSS,
  gridBgPositionCSS,
  gridBgSizeCSS,
  tileTransformCSS,
} from "./coordinates";
export { type GestureCallbacks, installGestures } from "./gestures";
export {
  clampZoom,
  computeCenterPan,
  GRID_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeDelta,
  snapToGrid,
  zoomToCenter,
  zoomTowardPoint,
} from "./transforms";
export { type CanvasViewport, useCanvasViewport } from "./useCanvasViewport";
