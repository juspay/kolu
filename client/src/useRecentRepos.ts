/** Recent repos — fetched from server for worktree creation without needing an active git terminal. */

import { createResource } from "solid-js";
import { client } from "./rpc";
import type { RecentRepo } from "kolu-common";

const [recentRepos, { refetch }] = createResource<RecentRepo[]>(
  () => client.git.recentRepos(),
  { initialValue: [] },
);

export function useRecentRepos() {
  return { recentRepos, refetch };
}
