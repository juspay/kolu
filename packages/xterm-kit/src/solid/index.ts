/** `@kolu/xterm-kit/solid` — the SolidJS browser adapter.
 *
 *  Everything here depends on `solid-js` and a DOM, so it stays OUT of the
 *  runtime-neutral core (`@kolu/xterm-kit`) that kaval's daemon imports. The
 *  component composes the primitives below; each is also exported so a non-JSX
 *  consumer can compose them itself. */

// The freeze-while-reading scroll lock and its DOM wiring.
export { createScrollLock, SCROLL_INTENT_WINDOW_MS } from "./scrollLock";
export type { ScrollIntentSource, ScrollLockEvent } from "./scrollLock";
export { wireScrollIntent } from "./scrollLockWiring";
export type { ScrollIntentTarget } from "./scrollLockWiring";

// Forced synchronous repaint when the rAF paint loop parks under occlusion.
export {
  createRenderRecovery,
  PAINT_STALL_WARN_MS,
  WATCHDOG_DELAY_MS,
} from "./renderRecovery";
export type { RenderRecovery, RenderRecoveryProbes } from "./renderRecovery";

// The mobile touch surface xterm 6.0 ships none of.
export { enableSoftKeyboardInput } from "./softKeyboardInput";
export { wireTouchScroll, wireTouchTaps } from "./touch";
export type { TouchScrollTarget } from "./touch";
export { isCoarsePointer } from "./pointer";

// Owner-correct async construction + disposal of an xterm terminal.
export { createXtermLifecycle } from "./xtermLifecycle";
export type { XtermCore, XtermLifecycleOptions } from "./xtermLifecycle";

// Single-owner WebGL addon lifetime + context-loss recovery.
export { attachWebGL } from "./webgl";
export type { WebglHandle, WebglLifecycleHooks } from "./webgl";

// The component: the whole hazard set as one JSX element.
export { Xterm } from "./Xterm";
export type { ScrollLock, XtermHandle } from "./Xterm";
