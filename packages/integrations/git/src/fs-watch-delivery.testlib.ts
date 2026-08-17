/**
 * One platform fact, shared by every test in this package that gates on a
 * filesystem-watch EVENT ARRIVING: darwin does not deliver one on a clock a
 * test can wait out.
 *
 * ## What was measured
 *
 * On kolu's darwin CI box (`ci@petit`, macOS 26.5.2, aarch64, load ~7),
 * against `@parcel/watcher@2.5.6` with the `fs-events` backend this package
 * pins — the numbers behind juspay/kolu#2175:
 *
 *   * a live subscription delivered its first event **14.2s** after the write,
 *     then in batches every **15.0s**. 53 of 53 events arrived: nothing was
 *     lost, everything was late. Linux/inotify answers the same writes in
 *     milliseconds;
 *   * the churn cases below, re-run there with a widened budget, passed with
 *     deliveries at 12.5s / 13.5s / 14.5s — three of four teardown-and-rebuild
 *     cycles — while the fourth stayed silent for the full **180s**;
 *   * that residual silence is NOT this package: a standalone script driving
 *     `@parcel/watcher` directly, with no kolu code in the loop, ran 16 of the
 *     same subscribe→unsubscribe→subscribe→write cycles and had one deliver
 *     nothing within 60s (deliveries otherwise 0.2s–14.7s);
 *   * `fs.watch` — libuv's own FSEvents stream, same process, same directory —
 *     answered in **1.3s** throughout. The daemon was serving that host
 *     promptly, so the lateness belongs to parcel's stream, which omits
 *     `kFSEventStreamCreateFlagNoDefer` (`src/macos/FSEventsBackend.cc`,
 *     `startStream`). Deferred delivery on a volume under constant churn — a
 *     box building Nix and running e2e all day — collapses to the daemon's
 *     maximum coalescing window, and 15s is what that window measured. The
 *     host's `fseventsd` was 21 days up, 6.5 GB resident, burning ~190% CPU.
 *
 * ## Why these tests are skipped rather than given a bigger budget
 *
 * A wider budget fixes the 15s quantization but not the residual
 * non-delivery, so darwin would trade a deterministic red for a flaky one on
 * a REQUIRED status — the worst of both — and pay tens of seconds of lane
 * time for it. Nothing here is skipped for convenience: the invariants are
 * platform-independent and linux/inotify pins them on every commit, in
 * milliseconds, with the same code under test.
 *
 * Local darwin developers skip these too — a busy laptop produces the same
 * false negatives. juspay/kolu#2175 carries the full probe transcript and the
 * three ways out: get `fseventsd` healthy on the box, an upstream parcel that
 * passes `NoDefer`, or a level-triggered poll beneath the watcher's fast path
 * (the shape `kolu-io`'s `refcounted-dir-watcher` already uses).
 */
export const SKIP_DARWIN_FSWATCH = process.platform === "darwin";
