/** The forge-adapter contract — a pure resolver.
 *
 *  Deliberately *not* subscribe-shaped: a provider is a stateless
 *  `resolve(git)`, and the generic watcher (`subscribePr`) calls it on
 *  each resolve. One watcher lives for a terminal's whole life — no
 *  teardown/rebuild machinery, no `lastKey`, and the git channel's
 *  synchronous `onEvent` contract is never crossed by an awaited
 *  detection (see the anyforge Atlas note, decision D3). */

import type { Logger } from "kolu-shared";
import type { PrResult, PrUnavailableSourceBase } from "./schemas.ts";

/** The git state a resolve needs — handed through `PrWatcher.setGit` and
 *  passed verbatim to the provider. */
export type PrGitContext = {
  repoRoot: string;
  branch: string;
  /** The repo's `origin` remote URL (credentials stripped), or null when the
   *  repo has no remote. Carried so an upstream dispatcher can pick the forge
   *  adapter from the host; the gh adapter ignores it (gh derives the remote
   *  from the repo itself). */
  remoteUrl: string | null;
};

export interface PrProvider<
  S extends PrUnavailableSourceBase = PrUnavailableSourceBase,
> {
  /** Discriminator for this adapter, e.g. "github" — mirrors anyagent's
   *  AgentProvider.kind: string. The leaf enumerates no forge. */
  readonly kind: string;
  /** Resolve the PR for the given git context. Must not throw — failures
   *  are classified into the `PrResult` variants (`absent` for "no PR can
   *  exist here", `unavailable` with this adapter's typed source `S` for
   *  everything actionable). */
  resolve(git: PrGitContext, log?: Logger): Promise<PrResult<S>>;
}
