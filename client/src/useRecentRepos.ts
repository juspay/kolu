/** Recent repos — live-streamed from server for worktree creation. */

import { createSignal } from "solid-js";
import { client } from "./rpc";
import type { RecentRepo } from "kolu-common";

const [recentRepos, setRecentRepos] = createSignal<RecentRepo[]>([]);

// Subscribe to the live stream — first value is the current list, then updates.
const controller = new AbortController();
(async () => {
  try {
    const stream = await client.git.onRecentReposChange(
      {},
      { signal: controller.signal },
    );
    for await (const repos of stream) setRecentRepos(repos);
  } catch {
    // Stream aborted — expected on cleanup
  }
})();

export function useRecentRepos() {
  return { recentRepos };
}
