/**
 * One platform fact, shared by every test in this package that gates on a
 * filesystem-watch EVENT ARRIVING: darwin does not deliver one on a clock a
 * test can wait out.
 *
 * Two different watch paths land under this flag, and they fail differently —
 * both measured on the darwin CI box, neither answerable by a bigger budget.
 *
 * ## `@parcel/watcher` — late, but consistently so
 *
 * The working-tree churn cases. A live subscription's first event arrived
 * **14.2s** after the write and then in 15.0s batches, everything eventually
 * delivered; those cases allow 3s, so a HEALTHY watcher reads as dead,
 * deterministically. Widening does not rescue them: re-run there with a wide
 * budget, three of four teardown-and-rebuild cycles landed near 14s and the
 * fourth stayed silent for the full 180s — and that silence is not this
 * package's, since a script driving `@parcel/watcher` directly, with no kolu
 * code in the loop, reproduced it once in 16 cycles. So darwin would trade a
 * deterministic red for a flaky one on a REQUIRED status.
 *
 * ## `fs.watch` — not late, unpredictable
 *
 * The git-dir watcher cases (HEAD/reflog/index, via `kolu-io`'s
 * `refcounted-dir-watcher`). Do NOT read the parcel numbers above as this
 * path's: libuv's own FSEvents stream, probed on the same box in the same
 * process, answered in **1.3s** — and in a later probe delivered nothing at
 * all for a 20s window. That spread IS the failure: not a clock to wait out
 * but non-determinism under contention, which is what these skips were
 * originally written for (juspay/kolu#320, since closed) and why the file's
 * `waitForHeadEvent` re-touches HEAD across six attempts rather than trusting
 * one budget. A test cannot pick a number against that.
 *
 * ## Why skipping is honest here
 *
 * Nothing is skipped for convenience. Both invariants are
 * platform-independent — the parcel serialization fix, and the dispatcher's
 * snapshot + try/catch per listener — and linux/inotify pins both on every
 * commit, in milliseconds, against the same code. Local darwin developers skip
 * them too: a busy laptop produces the same false negatives.
 *
 * WHY the platform behaves this way — parcel's stream omitting
 * `kFSEventStreamCreateFlagNoDefer`, the daemon's coalescing window, the state
 * of that box — is parcel knowledge, and lives once, in the `parcel` skill's
 * *"macOS: delivery can run ~15s behind"* failure mode. juspay/kolu#2175
 * carries the full probe transcript.
 */
export const SKIP_DARWIN_FSWATCH = process.platform === "darwin";
