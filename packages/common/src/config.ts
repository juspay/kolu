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
 *  browser, not the server. */
export const DEFAULT_SCROLLBACK = 50_000;

/** The SERVER-side headless mirror's scrollback, in lines — deliberately a
 *  SEPARATE, smaller constant than the client's.
 *
 *  kaval keeps one `@xterm/headless` mirror per LIVE terminal, and live
 *  terminals accumulate without bound (never reaped — adopted across every
 *  restart). At the old shared 50K each mirror cost ~16 MB of V8 old-space
 *  heap, so a few hundred live terminals exhausted the ~4 GB ceiling and
 *  SIGABRT'd the daemon — a recurring production crash. See
 *  `docs/atlas/src/content/atlas/kaval-heap-oom.mdx` (RCA + the A/B that sets
 *  this number).
 *
 *  The mirror only needs enough scrollback to (a) feed the live jobs that read
 *  it — OSC metadata, device-query replies, the screen-scrape tail — and (b)
 *  repaint a COLD-attaching client (a fresh tab with no local buffer). A warm
 *  client keeps its own `DEFAULT_SCROLLBACK`, and PDF export reads the client
 *  buffer, so shrinking the mirror regresses neither. 10K lifts the OOM ceiling
 *  ~4x (measured ~16 MB → ~3.9 MB/terminal) while still giving a cold reconnect
 *  10K lines of restored history. (Raising the ceiling, not removing the
 *  linear-in-count growth — that is #417, the on-disk transcript log.) */
export const MIRROR_SCROLLBACK = 10_000;
