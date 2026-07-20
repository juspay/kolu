/** Pick the storage backend for the per-tab ACTIVE host pref from the window's LAUNCH
 *  CONTEXT — decided ONCE at boot, never a user knob (conventions.md fail-fast: no
 *  config, no override; the backend is a STRUCTURAL FACT of how the app was launched).
 *
 *  Every other client pref rides `localStorage` and durable facts are server-side, but
 *  the active host alone rode `sessionStorage`. That is right for a browser TAB (two tabs
 *  view two hosts independently; a fresh tab starts local) but WRONG for an installed PWA:
 *  a standalone window has no sibling tabs and every relaunch is a fresh browsing session,
 *  so `sessionStorage` is empty on launch and the app silently reverts to `LOCAL_HOST` —
 *  amnesia about which host the user was on, on every PWA launch. The server-side session
 *  restores the workspace, but not *which host* views it.
 *
 *  So the backend is chosen from the launch context, not baked in:
 *  - STANDALONE / installed PWA window → `localStorage` (survives relaunch);
 *  - regular browser TAB → `sessionStorage` (unchanged: per-tab isolation).
 *
 *  Pure over an injected window slice and injected backends, so the decision is
 *  unit-pinnable without a real installed PWA (see `activeHostStorage.test.ts`). */

// The legacy iOS-Safari standalone flag is a non-standard `Navigator` property the TS
// DOM lib omits; declare it (matching how the codebase augments lib types for
// showSaveFilePicker etc.) so the real `window.navigator` shares the `standalone`
// property with StandaloneSignals below and stays assignable to it (TS weak-type
// detection otherwise rejects an all-optional target with zero properties in common).
declare global {
  interface Navigator {
    /** iOS Safari only: `true` when the page runs as a home-screen web app. */
    readonly standalone?: boolean;
  }
}

/** The minimal window surface {@link launchedStandalone} reads: the standard
 *  `display-mode` media query plus the legacy iOS `navigator.standalone`. A slice, not
 *  the whole `Window`, so a unit injects two booleans instead of stubbing a DOM. */
export interface StandaloneSignals {
  matchMedia: (query: string) => { matches: boolean };
  navigator: { standalone?: boolean };
}

/** The two web-storage backends, injected so tests pass synchronous in-memory fakes. */
export interface StorageBackends {
  local: Storage;
  session: Storage;
}

/** Is THIS window an installed / standalone surface (whose relaunch is the same
 *  "session" to the user) rather than a plain browser tab? Reads two ORTHOGONAL platform
 *  signals, because no single one covers every installed context:
 *  - `display-mode: standalone` — the standard signal (Chromium desktop PWAs, Android
 *    home-screen apps, installed PWAs generally);
 *  - `navigator.standalone === true` — the legacy iOS-Safari signal for a home-screen web
 *    app, which never adopted the media query.
 *  Either being true means "installed". No optional-chaining / try-catch guard: per the
 *  fail-fast rule, a window missing `matchMedia` is a broken platform to crash on, not to
 *  silently paper over. */
export function launchedStandalone(win: StandaloneSignals): boolean {
  return (
    win.matchMedia("(display-mode: standalone)").matches ||
    win.navigator.standalone === true
  );
}

/** The storage-backend decision: standalone launch context → the survive-relaunch
 *  backend (`localStorage`), tab context → per-tab (`sessionStorage`). The ONE call site
 *  is `wire.ts`'s `activeHost` pref; kept beside `groundActiveHost` as a pure,
 *  dependency-light host helper. */
export function activeHostStorage(
  win: StandaloneSignals,
  backends: StorageBackends,
): Storage {
  return launchedStandalone(win) ? backends.local : backends.session;
}
