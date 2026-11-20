/**
 * Gates every test in this package that waits on a filesystem-watch EVENT
 * ARRIVING: darwin does not deliver one on a clock a test can wait out.
 *
 * `@parcel/watcher`: a live subscription's first event arrived 14.2s after the
 * write and then in 15.0s batches, and one teardown-and-rebuild cycle in four
 * stayed silent for a full 180s — reproduced with no kolu code in the loop.
 *
 * `fs.watch` (libuv's FSEvents stream): answered in 1.3s in one probe and
 * delivered nothing at all for 20s in another — non-determinism under
 * contention, not a budget to widen (juspay/kolu#2175 carries the transcript).
 *
 * Both invariants are platform-independent, and linux/inotify pins them on
 * every commit.
 */
export const SKIP_DARWIN_FSWATCH = process.platform === "darwin";
