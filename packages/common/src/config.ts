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

/** WebSocket URL query param carrying the client's last-known server
 *  `processId`. The client echoes it on every (re)connect so the server can
 *  recognize a stale tab reconnecting to a RESTARTED instance at the handshake —
 *  before any dead-terminal stream subscription replays. Absent on the first
 *  connect (the client hasn't observed an identity yet). */
export const SERVER_PROCESS_ID_PARAM = "pid";

/** WebSocket close code the server uses to reject a client bound to a previous
 *  process (its `pid` query param no longer matches `serverProcessId`). In the
 *  application range (4000–4999, per RFC 6455 §7.4.2). The client treats this
 *  code as a definitive restart — it surfaces the reload overlay instead of
 *  replaying subscriptions against the new instance. */
export const STALE_PROCESS_CLOSE_CODE = 4001;

/** Default font size for the terminal (px). */
export const DEFAULT_FONT_SIZE = 14;

/** Scrollback buffer size in lines. Sized for multi-hour Claude sessions
 *  so PDF export (see `exportScrollbackAsPdf.ts`) captures a useful window —
 *  the export reads from this same ring buffer. Per-line memory in xterm
 *  is small, so 50K is low tens of MB per terminal in the worst case.
 *
 *  Single source of truth for both the client's visible scrollback and the
 *  server's headless ring buffer — the local backend reads this and passes
 *  it to `@kolu/pty-host`'s `spawn` so the server-side headless terminal
 *  stays in lock-step with what the client renders. */
export const DEFAULT_SCROLLBACK = 50_000;
