/**
 * ONE policy, one name: what this package does with a teardown that itself
 * FAILED, at an exit that has a value to produce and no caller left to raise to.
 *
 * There are two such exits in `@kolu/surface` — a following wire releasing the
 * generation it superseded (`./links/following`), and a client bundle retiring a
 * sibling that left its roster (`./solid/surfaceClient`) — and both had the
 * decision written out in their own words. A policy spelled twice is one a reader
 * has to RECOGNISE by shape rather than grep by name, and the two spellings had
 * already drifted on the small question of what to pass as the cause.
 *
 * The policy itself is not negotiable in either direction. It is not a raise: the
 * value the call exists to produce — the new generation live, or the bundle on
 * its new roster — is already delivered by the time the old resource is closed,
 * and failing over its teardown would tell the caller that a move which completed
 * did not. And it is never a SWALLOW: a caught error that collapses to nothing is
 * the repo's `caught-error-must-not-collapse-to-empty` defect, and here the line
 * is the whole remedy — the resource is leaked, and the only thing left to do is
 * say so, with the cause attached.
 *
 * The WORDING stays at the site, because only the site knows what leaked.
 * Package-internal: not exported through any `@kolu/surface/*` subpath.
 */

/** Report a leaked resource whose teardown failed. `what` is the site's own
 *  sentence — it must name the resource and say that it is leaked; `cause` is the
 *  teardown's own error, never dropped. */
export function reportLeakedTeardown(what: string, cause: unknown): void {
  console.error(what, cause);
}
