/**
 * Activity feed — server-derived MRU lists of recent repos cd'd into and
 * recent agent CLIs spotted via OSC 633;E.
 *
 * Read-only singleton subscription. The server is the sole writer
 * (`trackRecentRepo` / `trackRecentAgent`); clients can't mutate this feed.
 * After #577 the activity feed has its own dedicated channel, so a high-
 * frequency activity tick can't piggyback unrelated state into the client.
 */

import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
import { stream } from "../rpc/rpc";
import type { RecentRepo, RecentAgent } from "kolu-common";

const sub = createRoot(() =>
  createSubscription(() => stream.activityFeed(), {
    onError: (err) =>
      toast.error(`Activity feed subscription error: ${err.message}`),
  }),
);

export function useActivityFeed() {
  return {
    recentRepos: (): RecentRepo[] => sub()?.recentRepos ?? [],
    recentAgents: (): RecentAgent[] => sub()?.recentAgents ?? [],
  } as const;
}
