/** `@kolu/solid-xterm` — SolidJS-native primitives over `@xterm/xterm`.
 *
 *  Encapsulates the imperative, leak-prone corners of running xterm.js so the
 *  app doesn't have to relearn them. Today that's the WebGL-context lifecycle
 *  (`createXtermWebgl`); the leak-critical async mount/dispose ordering still
 *  lives at the call site, where SolidJS owner capture must happen. */

export type { XtermWebgl, XtermWebglHooks } from "./createXtermWebgl";
export { createXtermWebgl } from "./createXtermWebgl";
