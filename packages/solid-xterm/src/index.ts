/** `@kolu/solid-xterm` — the single package that owns xterm.js.
 *
 *  Like electricity becoming a utility, every consumer (the browser UI in
 *  `kolu-client`, the headless screen mirror in `kolu-pty-host`) plugs into
 *  this package instead of wiring `@xterm/*` directly. Nothing else in the
 *  repo imports `@xterm/*`.
 *
 *  This barrel is the package's **public surface** — only what an external
 *  consumer actually imports. The leaf mechanics (`createScrollLock`,
 *  `createSafeClipboardProvider`, `createLineLinkProvider`) and the
 *  register/track *write* sides of the refs/diagnostics/webgl registries are
 *  composed internally by `createXterm` via relative imports; they are NOT
 *  re-exported, because exposing them would advertise composability that can't
 *  be exercised without importing `@xterm/*` (which this package exists to
 *  prevent) or without `createXterm`'s reactive-owner lifecycle dance. */

export {
  createXterm,
  type RendererPolicy,
  type XtermHandle,
  type XtermKeyContext,
  type XtermOptions,
} from "./createXterm.ts";
export type { ITheme } from "@xterm/xterm";
// Search controller — consumed by the client's SearchBar chrome.
export {
  createTerminalSearch,
  type SearchAddon,
  type TerminalSearch,
} from "./search.ts";
// Link-match shape — the client's file-ref matcher returns it.
export type { LineLinkMatch } from "./links.ts";
// Read-side registry/diagnostics observers — consumed by the diagnostics
// dialog, debug console hooks, export-PDF, and screenshot. The write side
// (register*/track*) is internal to createXterm.
export {
  getTerminalRefs,
  type TerminalProbes,
  type TerminalRefs,
} from "./terminalRefs.ts";
export {
  getDiagnostics,
  type Renderer,
  type TerminalDiagnostics,
} from "./diagnostics.ts";
export {
  type CanvasSizeEntry,
  type WebglEvent,
  type WebglLifecycleSnapshot,
  webglLifecycleSnapshot,
} from "./webglTracker.ts";
export { XTERM_VERSION } from "./version.ts";
