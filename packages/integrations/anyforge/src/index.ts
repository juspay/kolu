/** anyforge — the forge-neutral PR kernel.
 *
 *  Leaf package (deps: kolu-shared types + zod + ts-pattern) owning the
 *  things that are stable while forges vary: the wire vocabulary
 *  (`./schemas.ts`), the adapter contract (`PrProvider`), and the generic
 *  poll loop (`subscribePr`). Forge adapters — kolu-github today — implement
 *  `PrProvider` against these shapes and never import each other; `anyagent`
 *  is the same move for agents. The leaf enumerates no forge. */

export { parseRemoteHost } from "./detect.ts";
export { logPrResolveFailure } from "./log-helper.ts";
export type { PrGitContext, PrProvider } from "./provider.ts";
export { type PrWatcher, subscribePr } from "./subscribe.ts";
// The wire vocabulary is the whole point of ./schemas.ts — re-export it
// wholesale rather than hand-maintaining a list that drifts every time a
// schema or helper is added. (./provider, ./subscribe stay explicit:
// they're the node-side surface, not at drift risk.)
export * from "./schemas.ts";
