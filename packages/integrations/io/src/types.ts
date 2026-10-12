/** kolu-io's pure DATA shapes — deliberately free of `node:` imports.
 *
 *  Every other module here touches the filesystem or spawns a process, so a
 *  consumer that only needs to NAME a result would otherwise drag the whole
 *  node-typed graph into its program. `anyagent` is exactly that consumer: the
 *  agent contract declares that a terminal's snapshot carries a
 *  {@link ProcessSnapshot}, and it is a runtime-agnostic package with no node
 *  types at all. Splitting the shape from the reader keeps ONE definition of it
 *  (the alternative — a structural twin in the contract package — is two
 *  sources of truth for one record) without inverting the dependency arrow:
 *  `anyagent` depends on this leaf, never the reverse.
 */

/** The argv + environment a live pid was STARTED with. */
export interface ProcessSnapshot {
  argv: string[];
  /** The process's environment, or `null` when this platform cannot report it
   *  (macOS redacts even a same-user process's env). `null` and `{}` are
   *  DIFFERENT facts: "unreadable by policy" vs "started with no environment",
   *  and a consumer that resolves paths from env vars must know which one it is
   *  holding. */
  env: Record<string, string> | null;
}
