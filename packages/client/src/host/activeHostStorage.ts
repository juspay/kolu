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
 *  So the backend is chosen from whether the window is INSTALLED (an installed / standalone
 *  PWA surface, whose relaunch is the same "session" to the user), not baked in:
 *  - INSTALLED / standalone → `localStorage` (survives relaunch);
 *  - regular browser TAB → `sessionStorage` (unchanged: per-tab isolation).
 *
 *  "Installed?" is NOT re-derived here — it is `@kolu/surface-app`'s canonical fact
 *  ({@link isInstalledFromEnv} over an {@link InstallEnv}), the same one `useSurfaceApp().isInstalled()`
 *  reads reactively elsewhere in the client. The only genuinely-new logic in this module is
 *  the INSTALLED→localStorage / tab→sessionStorage mapping. */

import { type InstallEnv, isInstalledFromEnv } from "@kolu/surface-app/solid";

/** Read the live browser install environment into surface-app's canonical {@link InstallEnv}.
 *
 *  This deliberately MIRRORS surface-app's own `readInstallEnv` rather than reusing it:
 *  that reader is not exported, and exporting it would turn a client-local storage tweak
 *  into a `@kolu/surface-app` public-API change — a drishti pair-PR + odu-impact verdict
 *  (`.claude/rules/surface.md`) disproportionate to this fix. What "installed" MEANS still
 *  stays single-owned: the DECISION delegates to the exported {@link isInstalledFromEnv};
 *  only this thin DOM read lives here. It matches surface-app's THREE installed display-modes
 *  (standalone / minimal-ui / fullscreen) and its inline-cast for the non-standard iOS
 *  `navigator.standalone`, so the two "installed?" answers cannot diverge and no third
 *  `declare global` Navigator copy is added. Reads globals directly (like surface-app); the
 *  install DECISION is {@link isInstalledFromEnv} (surface-app's kernel), and the
 *  injectable, unit-pinnable seam is {@link activeHostStorage}, which takes the verdict as a boolean. */
function readInstallEnv(): InstallEnv {
  const displayModeStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  return {
    isSecureContext: window.isSecureContext,
    displayModeStandalone,
    navigatorStandalone:
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  };
}

/** The two web-storage backends, injected so tests pass synchronous in-memory fakes. */
export interface StorageBackends {
  local: Storage;
  session: Storage;
}

/** The storage-backend decision — the one thing this module owns: an INSTALLED launch
 *  context → the survive-relaunch backend (`localStorage`), a regular tab → per-tab
 *  (`sessionStorage`). Pure over the install verdict as a boolean (surface-app's
 *  {@link isInstalledFromEnv} owns deriving it) and injected backends, so the pick is
 *  unit-pinnable without a real PWA and without re-exercising surface-app's install kernel. */
export function activeHostStorage(
  installed: boolean,
  backends: StorageBackends,
): Storage {
  return installed ? backends.local : backends.session;
}

/** Boot-time convenience: read the LIVE install env and pick the backend. The one call
 *  site is `wire.ts`'s `activeHost` pref, at module init — before the `<SurfaceAppProvider>`
 *  owner exists, so the reactive `useSurfaceApp().isInstalled()` isn't reachable and a
 *  synchronous read is required. Kept as a thin split from the pure {@link activeHostStorage}
 *  so the decision stays testable with an injected verdict. */
export function activeHostStorageForLaunch(backends: StorageBackends): Storage {
  return activeHostStorage(isInstalledFromEnv(readInstallEnv()), backends);
}
