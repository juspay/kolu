/**
 * The one surface this whole package speaks — re-exported from
 * `@kolu/terminal-workspace/surface` so the client's `wire.ts` and the (test's)
 * agent stand-up name it through a single module, the way `drishti-common`'s
 * `surface` is shared across drishti's tiers. The server reaches the surface
 * directly (it also needs `DEFAULT_VERSION` etc.), so this module stays minimal:
 * the surface value + the contract type the client's `websocketLink` is generic
 * over.
 */

import { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";

export { terminalWorkspaceSurface };

/** The contract the remote pulam daemon serves and the parent re-serves —
 *  `terminalWorkspaceSurface`'s. The client's `websocketLink<ArivuContract>` and
 *  the server's `getHostSession<ArivuContract>` are both generic over it. */
export type ArivuContract = typeof terminalWorkspaceSurface.contract;
