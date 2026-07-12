/**
 * A neutral shared CLOCK primitive for `@kolu/surface` — the single source both the
 * heartbeat's suspension check and a downstream consumer's ceiling clock read, so
 * neither module reaches into the other's internals for it. It is not a heartbeat
 * concept; it lives here, on its own, and both `@kolu/surface/heartbeat` and
 * `@kolu/surface-remote`'s session watchdog import it from this one home.
 */

/** The monotonic clock a suspension / running-time check reads — `performance.now()`
 *  where present (every browser, Node ≥ 16), else `Date.now()`. The fallback collapses
 *  the wall/mono gap to ~0, which only DISABLES suspension-voiding (degrading to the
 *  pre-fix behaviour where a frozen-then-resumed probe forces a reconnect) — it never
 *  blinds the watchdog, the fail-safe direction. */
export const monotonicNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
