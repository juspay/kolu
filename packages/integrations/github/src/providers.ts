/** Provider interfaces — kolu-github's local-vs-remote receptacles.
 *
 *  Mirrors the `GitInfoProvider` / `FsProvider` pattern from kolu-git.
 *  Future remote impl runs `gh pr view` on a remote kolu-agent (so the
 *  remote user's gh auth is used) instead of the local one.
 *
 *  Naming note: there is NOT a cross-forge `PrProvider` (github+bitbucket)
 *  here — that's a different axis. The comment in
 *  `packages/server/src/meta/github.ts` flags that extraction explicitly
 *  as premature until Bitbucket support lands. This interface is the
 *  local-vs-remote axis only.
 */

import type { Logger } from "kolu-shared";
import { type GitHubPrWatcher, subscribeGitHubPr } from "./resolve.ts";
import type { PrResult } from "./schemas.ts";

/** Live source for one terminal's PR state. Owns its own polling loop +
 *  branch-change dedup; the caller just drives `setGit` on git events. */
export interface GitHubPrProvider {
  subscribe(onChange: (pr: PrResult) => void, log?: Logger): GitHubPrWatcher;
}

/** Local impl — wraps `subscribeGitHubPr`. Stateless; shared. */
export const localGitHubPrProvider: GitHubPrProvider = {
  subscribe(onChange, log) {
    return subscribeGitHubPr(onChange, log);
  },
};
