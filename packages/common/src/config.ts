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
 *  and what `exportScrollbackAsPdf.ts` serializes. Sized for multi-hour Claude
 *  sessions so scroll-back and PDF export capture a useful window. This is the
 *  user's own tab (one terminal on screen at a time), so the memory lives in the
 *  browser, not the server.
 *
 *  A distinct axis from the SERVER-side per-terminal headless-mirror depth,
 *  which is deliberately smaller and lives where the mirror lives — kaval pins
 *  the mirror to its `HOT_WINDOW` (deep history moved off the heap to the on-disk
 *  transcript; see `docs/atlas/src/content/atlas/kaval-memory-architecture.mdx`). */
export const DEFAULT_SCROLLBACK = 50_000;
