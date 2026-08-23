/**
 * Centralized config defaults for kolu.
 *
 * Collects magic numbers that were scattered across client and server
 * modules into one place so they stay in sync. `DEFAULT_PREFERENCES`
 * lives in `./surface` (next to `PreferencesSchema`) — config.ts holds
 * only typeless constants that don't depend on the surface domain.
 */

/** Default server port. Defined in `./defaultPort.ts` — a zero-import leaf — so
 *  the kolu command tree can read it without dragging this module's terminal
 *  vocabulary (see that file's header); re-exported here because this is the
 *  door app-side consumers already know. */
export { DEFAULT_PORT } from "./defaultPort.ts";

// The stale-tab handshake constants (`SERVER_PROCESS_ID_PARAM` /
// `STALE_PROCESS_CLOSE_CODE`) graduated to `@kolu/surface-app`'s framework-free
// core — both ends import them from there, so the wire contract has one home.

/** Default font size for the terminal (px). */
export const DEFAULT_FONT_SIZE = 14;

/** The CLIENT's visible scrollback, in lines — what the browser xterm retains
 *  and what `exportScrollbackAsPdf.ts` serializes. Re-exported from its home in
 *  `@kolu/terminal-vocab` (the shared browser-safe terminal vocabulary) so the
 *  per-host daemon `@kolu/padi` can read the SAME fact for its scrollback-backfill
 *  headroom assertion WITHOUT the forbidden `@kolu/padi → kolu-common` back-edge,
 *  and so the value rides padi's hashed build closure. App-side consumers keep
 *  importing it from here unchanged. */
export { DEFAULT_SCROLLBACK } from "@kolu/terminal-vocab/schema";
