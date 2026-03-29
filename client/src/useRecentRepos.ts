/** Recent repos — fetched from server for worktree creation without needing an active git terminal. */

import { createResource } from "solid-js";
import { client } from "./rpc";
import type { RecentRepo } from "kolu-common";

let cached: ReturnType<typeof init> | undefined;

function init() {
  const [recentRepos, { refetch }] = createResource<RecentRepo[]>(
    () => client.git.recentRepos(),
    { initialValue: [] },
  );
  return { recentRepos, refetch };
}

export function useRecentRepos() {
  if (!cached) cached = init();
  return cached;
}
