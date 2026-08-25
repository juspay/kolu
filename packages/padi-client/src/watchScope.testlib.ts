/**
 * The scope constructor, unwrapped — the one copy.
 *
 * A pin exercises the same value `servePadi` hands the registry, not a
 * hand-shaped look-alike, so it builds scopes through {@link watchScopeOf}. But
 * the constructor answers with a refusal OR a scope, and a pin that meant to
 * build one and got a refusal has a bug in the pin — so this throws rather than
 * asserting against `undefined`. The refusals themselves are pinned in
 * `watchScope.test.ts`, beside the code that decides them.
 *
 * `.testlib.ts` and PUBLISHED, per this tier's convention for a fixture shared
 * across package lines (`@kolu/surface-daemon` publishes two the same way):
 * padi's four attention suites and this package's own pins were carrying
 * byte-identical copies of these six lines, which is the duplication padi's
 * attention fixture was itself written to delete. Excluded from the hashed
 * identity fileset, so it costs a daemon id nothing.
 */

import { type WatchScope, watchScopeOf } from "./watchScope.ts";

/** Build a scope, or throw the refusal's own message. */
export const scopeOf = (
  opts: Parameters<typeof watchScopeOf>[0],
): WatchScope => {
  const scope = watchScopeOf(opts);
  if (scope.kind === "error") throw new Error(scope.message);
  return scope.value;
};
