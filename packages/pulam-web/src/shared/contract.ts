/**
 * The one surface this whole package speaks — re-exported from
 * `@kolu/terminal-workspace/surface` so the client's `wire.ts` and the (test's)
 * agent stand-up name it through a single module, the way `drishti-common`'s
 * `surface` is shared across drishti's tiers. The server reaches the surface
 * directly (it also needs `DEFAULT_VERSION` etc.), so this module stays minimal:
 * the surface value + the contract type the client's `websocketLink` is generic
 * over.
 */

import { mirroredSurface } from "@kolu/surface-nix-host/connection";
import { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";

export { terminalWorkspaceSurface };

/** The surface the BROWSER consumes and the parent RE-SERVES: the daemon's
 *  `terminalWorkspaceSurface` augmented at the mirror seam with the get-only
 *  `connection` cell. The daemon serves the *base*; the parent mirrors the base
 *  and adds `connection` from `session.onState` — so the augmented cell exists
 *  exactly where it's parent-authored (the re-serve), nowhere else. */
export const arivuSurface = mirroredSurface(terminalWorkspaceSurface);

/** The AGENT contract — what the daemon serves, the session dials
 *  (`getHostSession<ArivuContract>`), and the mirror mirrors. The BASE surface,
 *  connection-free; the re-serve forwards/folds these primitives. */
export type ArivuContract = typeof terminalWorkspaceSurface.contract;

/** The BROWSER contract — base + `connection`. Consumed as a type by anything
 *  that types a wire client over the contract directly — today the test's
 *  `directLink<ArivuBrowserContract>` (reserve.test.ts). NOT what
 *  `surfaceClient(arivuSurface)` or the re-serve's `implementSurface(arivuSurface, …)`
 *  are generic over: those take the surface VALUE and are generic over its SPEC,
 *  not this contract alias. */
export type ArivuBrowserContract = typeof arivuSurface.contract;
