/** Shared log-level policy for a failed PR resolve — forge-neutral, so every
 *  adapter routes its failures the same way instead of re-deciding per forge. */

import type { Logger } from "kolu-shared";
import type { PrResult } from "./schemas.ts";

/** Route a failed PR resolve to the right log level:
 *    absent (no PR for this branch)  → debug (expected, not a problem)
 *    unsupported (no adapter for remote) → debug (expected, not a problem)
 *    unavailable + code "unknown"    → error (an actual unexpected bug)
 *    unavailable + any other code    → warn  (degraded-but-recoverable)
 *
 *  `label` names the resolver in the message (e.g. "gh pr view", "forgejo
 *  api") so a glance at the log says which adapter degraded. `ok`/`pending`
 *  are never passed here — this is the failure path. `unsupported` is likewise
 *  produced by the dispatch layer (not a resolver) and so isn't expected here,
 *  but it's handled as debug rather than mislogged as a `warn "unavailable"`
 *  should a future forge adapter route through this shared helper. */
export function logPrResolveFailure(
  err: unknown,
  result: PrResult,
  log: Logger,
  label: string,
): void {
  const ctx = { err: String(err), result: result.kind };
  if (result.kind === "absent") {
    log.debug(ctx, `${label}: no PR for branch`);
    return;
  }
  if (result.kind === "unsupported") {
    log.debug(ctx, `${label}: no adapter for remote`);
    return;
  }
  if (result.kind === "unavailable" && result.source.code === "unknown") {
    log.error(ctx, `${label}: unknown error`);
    return;
  }
  log.warn(
    result.kind === "unavailable" ? { ...ctx, code: result.source.code } : ctx,
    `${label}: unavailable`,
  );
}
