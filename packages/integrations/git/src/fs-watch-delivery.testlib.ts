/**
 * One platform fact, shared by every test in this package that gates on a
 * filesystem-watch EVENT ARRIVING: darwin does not deliver one on a clock a
 * test can wait out.
 *
 * WHY the platform behaves this way — parcel's stream omitting
 * `kFSEventStreamCreateFlagNoDefer`, the daemon's coalescing window, the state
 * of the box — is parcel knowledge, and lives once, in the `parcel` skill's
 * failure mode 5. juspay/kolu#2175 carries the full probe transcript. What
 * belongs HERE is only what decides the skip:
 *
 *   * measured on the darwin CI lane, a live subscription's first event
 *     arrived **14.2s** after the write and then in 15.0s batches, with
 *     everything eventually delivered. These cases allow 3s, and
 *     linux/inotify answers the same writes in milliseconds — so a HEALTHY
 *     watcher reads as dead there, deterministically;
 *   * a wider budget does not rescue them. Re-run there with one, three of
 *     four teardown-and-rebuild cycles landed near 14s and the fourth stayed
 *     silent for the full 180s — and that silence is not this package's: a
 *     script driving `@parcel/watcher` directly, no kolu code in the loop,
 *     reproduced it once in 16 cycles. Widening would trade a deterministic
 *     red for a flaky one on a REQUIRED status, and pay lane time for it.
 *
 * Nothing here is skipped for convenience: the invariants are
 * platform-independent, and linux/inotify pins them on every commit, in
 * milliseconds, against the same code. Local darwin developers skip them too —
 * a busy laptop produces the same false negatives.
 */
export const SKIP_DARWIN_FSWATCH = process.platform === "darwin";
