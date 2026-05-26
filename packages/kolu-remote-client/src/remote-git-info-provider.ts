/**
 * Remote git-info provider — `GitInfoProvider` impl that proxies
 * `subscribe(cwd, onChange)` calls over a `HostSession` to the remote
 * agent's `git.subscribeInfo` RPC. Phase 2b of kolu#951.
 *
 * Returns the same `GitInfoSubscription` shape the local provider
 * does, so the consumer in `meta/git.ts` doesn't pattern-match on
 * provider kind — it just calls `.subscribe(...)` and `.setCwd(...)`.
 */

import type { GitInfoProvider, GitInfoSubscription } from "kolu-git";
import type { GitInfo } from "kolu-git/schemas";
import type { Logger } from "kolu-shared";
import type { HostSessionLike } from "./host-session.ts";

export function remoteGitInfoProvider(
  session: HostSessionLike,
): GitInfoProvider {
  return {
    subscribe(
      cwd: string,
      onChange: (info: GitInfo | null) => void,
      _log?: Logger,
    ): GitInfoSubscription {
      // The session owns the subscription token across reconnects;
      // `onEvent` keeps firing on the new wire transparently. The
      // payload is the agent's `GitInfo | null` — same shape the local
      // provider emits.
      const token = session.subscribe<{ cwd: string }>(
        "git.subscribeInfo",
        { cwd },
        (payload) => onChange(payload as GitInfo | null),
      );
      return {
        setCwd: (next: string) => {
          // Fire-and-forget — the session re-issues the underlying
          // subscription with the new cwd. Any in-flight `onChange`
          // from the prior cwd is still ours to discard at the
          // consumer; the agent's `subscribeGitInfo` already drops
          // stale results past a `setCwd` boundary.
          void token.update({ cwd: next });
        },
        stop: () => {
          void token.close();
        },
      };
    },
  };
}
