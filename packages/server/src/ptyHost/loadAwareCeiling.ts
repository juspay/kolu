/**
 * The load-aware ceiling — the single source for "how slow can a swap-thrashing
 * production box be" across the daemon recycle.
 *
 * Two independent timeout axes encode this same volatility and so share this one
 * literal: the connect-retry window (how long a freshly-spawned daemon may take
 * to answer the socket) and the pid-gone barrier (how long the old daemon may
 * take to truly exit). The #1034 data-loss restart was a fixed 30s respawn
 * window lost to a ~2min teardown — these two ceilings are the same number
 * chosen for the same reason, so they must not drift apart. Tune the loaded-box
 * assumption here, once.
 *
 * Heartbeat cadence is a genuinely different concern (a steady liveness poll,
 * not a one-shot teardown wait) and stays separate.
 */
export const LOAD_AWARE_CEILING_MS = 120_000;
