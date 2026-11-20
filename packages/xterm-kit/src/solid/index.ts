export { createScrollLock, SCROLL_INTENT_WINDOW_MS } from "./scrollLock";
export type { ScrollIntentSource, ScrollLockEvent } from "./scrollLock";
export { wireScrollIntent } from "./scrollLockWiring";
export type { ScrollIntentTarget } from "./scrollLockWiring";

export {
  createRenderRecovery,
  PAINT_STALL_WARN_MS,
  WATCHDOG_DELAY_MS,
} from "./renderRecovery";
export type { RenderRecovery, RenderRecoveryProbes } from "./renderRecovery";

export {
  createOutputCoalesce,
  UNFOCUSED_COALESCE_MS,
} from "./outputCoalesce";
export type { OutputCoalesce, OutputCoalesceDeps } from "./outputCoalesce";

export { enableSoftKeyboardInput } from "./softKeyboardInput";
export { wireTouchScroll, wireTouchTaps } from "./touch";
export type { TouchScrollTarget } from "./touch";
export { isCoarsePointer } from "./pointer";

export { createXtermLifecycle } from "./xtermLifecycle";
export type { XtermCore, XtermLifecycleOptions } from "./xtermLifecycle";

export { attachWebGL } from "./webgl";
export type { WebglHandle, WebglLifecycleHooks } from "./webgl";

export { gridForBox, sameGrid } from "./grid";
export type { GridBox, TerminalGrid } from "./grid";
export { measureGridBox } from "./measureBox";

export { Xterm } from "./Xterm";
export type { ScrollLock, XtermHandle } from "./Xterm";
