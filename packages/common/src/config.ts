/**
 * Centralized config defaults for kolu.
 *
 * Collects magic numbers that were scattered across client and server
 * modules into one place so they stay in sync. `DEFAULT_PREFERENCES`
 * lives in `./surface` (next to `PreferencesSchema`) — config.ts holds
 * only typeless constants that don't depend on the surface domain.
 */

/** Default server port. */
export const DEFAULT_PORT = 7681;

// The stale-tab handshake constants (`SERVER_PROCESS_ID_PARAM` /
// `STALE_PROCESS_CLOSE_CODE`) graduated to `@kolu/surface-app`'s framework-free
// core — both ends import them from there, so the wire contract has one home.

/** Default font size for the terminal (px). */
export const DEFAULT_FONT_SIZE = 14;

/** The CLIENT's visible scrollback, in lines — what the browser xterm retains
 *  and what `exportScrollbackAsPdf.ts` serializes. Keep this bounded: canvas
 *  mode can mount many xterms at once, and xterm stores scrollback as live cell
 *  buffers in the Chrome renderer.
 *
 *  A distinct axis from the SERVER-side per-terminal headless-mirror depth,
 *  which lives where the mirror lives — kaval's `DEFAULT_MIRROR_SCROLLBACK`.
 *  The two hot windows match today, but remain separate ownership boundaries
 *  because one is Chrome renderer memory and the other is kaval daemon memory. */
export const DEFAULT_SCROLLBACK = 10_000;
