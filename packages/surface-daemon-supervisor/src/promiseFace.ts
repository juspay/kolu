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
 * So every Promise-shaped verb runs its effect through THIS function, and nowhere
 * else. That is the whole argument for the single run-edge allowlist row this
 * package carries: one boundary, named, with one call site to delete when the
 * consumers convert and the face goes Effect-shaped.
 *
 * Two kinds of caller reach it today, and the difference is worth stating rather
 * than blurring. The PUBLISHED verbs (`waitForPidGone`, `reapHolder`,
 * `dialSocket`, `driver.spawn`, the probe factory, `drainAndAwaitExit`) are the
 * boundary proper. The endpoint's own body and `converge` are the transitional
 * kind: they are still `async` functions, because their private binds are
 * Promise-shaped for a `converge` that has not converted either — so their
 * Effect-valued leaves (`waitForSocketEffect`, `connectSurvivorEffect`) are run
 * here too. Those calls are the measure of what is left: when the endpoint body
 * itself becomes an effect, they go, and the closure's mutable `let`s become the
 * `Ref`s that would only be ceremony while the surroundings stay `async`.
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
