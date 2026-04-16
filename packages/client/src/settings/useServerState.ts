/**
 * Unified server state — single reactive source backed by one subscription.
 *
 * Every caller shares the same module-level subscription. Preferences,
 * recent repos/agents, and saved session are all read through `sub()`,
 * which `createSubscription` backs with a `reconcile`'d store for
 * fine-grained reactivity per nested field.
 *
 * Mutations flow one direction: `updatePreferences` fires an RPC, the
 * server merges and persists, then echoes the merged state back via the
 * subscription. No separate local store is needed — and eliminating it
 * removes the race where a subscription push could overwrite a locally
 * applied change before the RPC round-tripped (issue #561).
 */

import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
import { client, stream } from "../rpc/rpc";
import { DEFAULT_PREFERENCES } from "kolu-common/config";
import type {
  ServerState,
  Preferences,
  PreferencesPatch,
  RecentRepo,
  RecentAgent,
  SavedSession,
} from "kolu-common";

// Module-level singleton. createRoot detaches the subscription's internal
// effect graph from any transient caller owner so it lives for the app.
const sub = createRoot(() =>
  createSubscription(() => stream.state(), {
    onError: (err) => toast.error(`Server state error: ${err.message}`),
  }),
);

export function useServerState() {
  /** Update one or more preferences. The server is authoritative; the
   *  merged result flows back through the subscription. */
  function updatePreferences(patch: PreferencesPatch) {
    void client.state
      .update({ preferences: patch })
      .catch((err: Error) =>
        toast.error(`Failed to save preferences: ${err.message}`),
      );
  }

  return {
    sub,
    /** Full server state (undefined while loading). */
    state: () => sub() as ServerState | undefined,
    /** Preferences — falls back to defaults until the first server push. */
    preferences: (): Preferences => sub()?.preferences ?? DEFAULT_PREFERENCES,
    recentRepos: () => (sub()?.recentRepos ?? []) as RecentRepo[],
    recentAgents: () => (sub()?.recentAgents ?? []) as RecentAgent[],
    savedSession: () => (sub()?.session ?? null) as SavedSession | null,
    updatePreferences,
  };
}
