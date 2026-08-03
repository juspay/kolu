/**
 * The supervisor's ONE Promise rind.
 *
 * The interior of this package is Effect: its waits are `Effect.sleep` on the
 * fiber clock, its races are `Effect.raceFirst`, its cleanups are scope
 * releases. Its *published* verbs are still Promises, because the consumers that
 * call them — `padi/src/ptyHost`, `padi/src/dial.ts`, `server/src/padi/*`, and
 * drishti's agent through `convergeAdmit` / `probeDaemonIdentityFrom` /
 * `drainAndAwaitExit` — have not converted yet. Flipping the face and the
 * interior in one move would make this package's rewrite un-landable on its own.
 *
 * So every Promise-shaped export runs its effect through THIS function, and
 * nowhere else. That is the whole argument for the single run-edge allowlist row
 * this package carries: one boundary, named, with one call site to delete when
 * the consumers convert and the face goes Effect-shaped.
 *
 * Failures surface as rejections with the ORIGINAL error object (Effect squashes
 * the cause to its first failure or defect), so `isNoListenerError`'s
 * `err.code`, `isContractSkewError`'s brand check, and every `rejects.toThrow`
 * in the suites read exactly what they read before.
 */
import { Effect } from "effect";

/**
 * Run an interior effect at the package's Promise boundary.
 *
 * `signal`, when given, is the caller's own AbortSignal (the `awaitExit` plug
 * contract still passes one): aborting it interrupts the fiber and every scope
 * it opened, which is what stops a poll loop from leaking a probe per tick.
 * Interruption REJECTS the promise, so a caller whose contract forbids that must
 * absorb it inside the effect — see `awaitHelloGone`, which races the abort as a
 * success instead.
 */
export function runFace<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  return Effect.runPromise(effect, signal ? { signal } : undefined);
}
