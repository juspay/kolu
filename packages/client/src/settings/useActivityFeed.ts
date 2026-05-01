/**
 * Activity feed — server-derived MRU lists of recent repos cd'd into and
 * recent agent CLIs spotted via OSC 633;E.
 *
 * Read-only singleton subscription. The server is the sole writer
 * (`trackRecentRepo` / `trackRecentAgent`); clients can't mutate this feed.
 * After #577 the activity feed has its own dedicated channel, so a high-
 * frequency activity tick can't piggyback unrelated state into the client.
 *
 * Implemented via `useCell` from `@kolu/cells/solid` (server-authority mode):
 * the framework's hook collapses the createSubscription + onError boilerplate
 * to one declaration.
 */

import { useCell } from "@kolu/cells/solid";
import { activityFeedCell } from "kolu-common/cells";
import type { RecentAgent, RecentRepo } from "kolu-common";
import { toast } from "solid-sonner";
import { client } from "../cells";

const cell = useCell(activityFeedCell, {
  source: client.activity.get,
  onError: (err) =>
    toast.error(`Activity feed subscription error: ${err.message}`),
});

export function useActivityFeed() {
  return {
    recentRepos: (): RecentRepo[] => cell.value()?.recentRepos ?? [],
    recentAgents: (): RecentAgent[] => cell.value()?.recentAgents ?? [],
  } as const;
}
