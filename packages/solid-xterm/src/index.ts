/** `@kolu/solid-xterm` — the single package that owns xterm.js.
 *
 *  Like electricity becoming a utility, every consumer (the browser UI in
 *  `kolu-client`, the headless screen mirror in `kolu-pty-host`) plugs into
 *  this package instead of wiring `@xterm/*` directly. Nothing else in the
 *  repo imports `@xterm/*`.
 *
 *  This file re-exports the public surface; implementation lives in sibling
 *  modules. It grows as the ralph loop pulls mechanics out of the client. */

export { createScrollLock } from "./scrollLock.ts";
export { createSafeClipboardProvider } from "./clipboard.ts";
export {
  createLineLinkProvider,
  type LineLinkMatch,
  type LineLinkOpts,
} from "./links.ts";
export {
  getTerminalRefs,
  registerTerminalRefs,
  type TerminalProbes,
  type TerminalRefs,
  unregisterTerminalRefs,
} from "./terminalRefs.ts";
export {
  getDiagnostics,
  registerDiagnostics,
  type Renderer,
  type TerminalDiagnostics,
} from "./diagnostics.ts";
export {
  type CanvasSizeEntry,
  trackCreate,
  trackDispose,
  trackLoseContextCalled,
  type WebglEvent,
  type WebglLifecycleSnapshot,
  webglLifecycleSnapshot,
} from "./webglTracker.ts";
