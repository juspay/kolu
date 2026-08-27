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

// `DEFAULT_FONT_SIZE` graduated to `terminal-themes`, beside `FONT_FAMILY` —
// the two are one fact (what a kolu terminal is drawn in) and both of kolu's
// readers already import the other from there. NOT re-exported back through this
// door: this module's manifest names eighteen workspace packages, and routing a
// terminal-rendering integer through it is what cost a consumer twenty-eight
// hydrated directories for one number, and so cost it the number.

/** The CLIENT's visible scrollback, in lines — what the browser xterm retains
 *  and what `exportScrollbackAsPdf.ts` serializes. Re-exported from its home in
 *  `@kolu/terminal-vocab` (the shared browser-safe terminal vocabulary) so the
 *  per-host daemon `@kolu/padi` can read the SAME fact for its scrollback-backfill
 *  headroom assertion WITHOUT the forbidden `@kolu/padi → kolu-common` back-edge,
 *  and so the value rides padi's hashed build closure. App-side consumers keep
 *  importing it from here unchanged. */
export { DEFAULT_SCROLLBACK } from "@kolu/terminal-vocab/schema";
