/** Recent repos — reads from unified server state. */

import { useServerState } from "./useServerState";

export function useRecentRepos() {
  const { recentRepos, invalidate } = useServerState();
  return {
    recentRepos,
    refetch: invalidate,
  };
}
