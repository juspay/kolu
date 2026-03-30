/** Recent repos — fetched from server for worktree creation without needing an active git terminal. */

import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { orpc } from "./orpc";
import type { RecentRepo } from "kolu-common";

export function useRecentRepos() {
  const query = createQuery(() => orpc.git.recentRepos.queryOptions());
  return {
    recentRepos: () => (query.data ?? []) as RecentRepo[],
    refetch: () => query.refetch(),
  };
}
