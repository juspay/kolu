/** `@kolu/xterm-kit/solid` — the SolidJS browser adapter.
 *
 *  Most modules here depend on `solid-js` and a DOM (so they stay OUT of the
 *  runtime-neutral core `@kolu/xterm-kit` that kaval imports). Pure write-path
 *  helpers used only by the browser consumer may live here without importing
 *  Solid. `<Xterm>` composes the lifecycle/WebGL/scroll-lock/recovery/coalesce/
 *  touch set; each primitive is also exported for non-JSX composition. */

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

// Unfocused-terminal write coalesce — cuts multi-agent main-thread paint/parse.
export {
  createOutputCoalesce,
  UNFOCUSED_COALESCE_MS,
} from "./outputCoalesce";
export type { OutputCoalesce, OutputCoalesceDeps } from "./outputCoalesce";

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

// The grid value + the one statement of grid equality.
export { sameGrid } from "./grid";
export type { TerminalGrid } from "./grid";

// The component: the whole hazard set as one JSX element.
export { Xterm } from "./Xterm";
export type { ScrollLock, XtermHandle } from "./Xterm";
