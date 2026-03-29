/** Recent repos — live-streamed from server for worktree creation. */

import { createQuery } from "@tanstack/solid-query";
import { orpc } from "./queryClient";
import type { RecentRepo } from "kolu-common";

/** Must be called inside a component (needs QueryClientProvider context). */
export function useRecentRepos() {
  const query = createQuery(() =>
    orpc.git.onRecentReposChange.experimental_liveOptions({ retry: true }),
  );
  return { recentRepos: () => (query.data ?? []) as RecentRepo[] };
}
