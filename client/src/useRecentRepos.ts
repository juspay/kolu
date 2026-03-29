/** Recent repos — live-streamed from server for worktree creation. */

import { createQuery } from "@tanstack/solid-query";
import { orpc } from "./queryClient";
import type { RecentRepo } from "kolu-common";

const query = createQuery(() =>
  orpc.git.onRecentReposChange.experimental_liveOptions({ retry: true }),
);

export function useRecentRepos() {
  return { recentRepos: () => (query.data ?? []) as RecentRepo[] };
}
