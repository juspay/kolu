/**
 * Agent-resume map — per-terminal captured agent CLI invocations, keyed by
 * saved-terminal id. Populated server-side on every OSC 633;E preexec hit
 * and persisted across kolu restarts so the session-restore UI can offer
 * "resume claude / codex / opencode" on restart.
 *
 * Read-only singleton subscription, parallel to `useSavedSession`. The
 * server is the sole writer (`trackAgentResume` / `clearAgentResume`).
 */

import { createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { createSubscription } from "../rpc/createSubscription";
import { stream } from "../rpc/rpc";
import type { SavedAgentResume } from "kolu-common";

const sub = createRoot(() =>
  createSubscription(() => stream.agentResume(), {
    onError: (err) =>
      toast.error(`Agent-resume subscription error: ${err.message}`),
  }),
);

export function useAgentResume() {
  return {
    /** The persisted per-terminal agent-resume map, or {} when none exists
     *  or the subscription hasn't yielded yet. */
    agentResume: (): SavedAgentResume => sub() ?? {},
  } as const;
}
