/** `@kolu/solid-xterm` — Solid-native pieces of xterm.js lifecycle.
 *
 *  Surface today: WebGL context management (`createXtermWebgl`).
 *  The framework grows as more wrong-altitude infrastructure
 *  migrates out of `client/src/terminal/Terminal.tsx` — addons,
 *  theme/font effects, resize observation, etc. Single-consumer
 *  inside Kolu today; the extraction is justified by the per-axis
 *  volatility encapsulation, not by reuse-count (same bar Surface
 *  and `solid-pierre` cleared).
 *
 *  Solid-native = the helpers register cleanups in the caller's
 *  Solid owner (assumed; document per-export). They are NOT
 *  components — callers wire data into them imperatively. */

export { createScrollLock } from "./scrollLock";
export {
  type AttachXtermStyleSyncOptions,
  attachXtermStyleSync,
} from "./styleSync";
export {
  type CreateXtermWebglOptions,
  createXtermWebgl,
  type XtermWebglHandle,
} from "./webgl";
