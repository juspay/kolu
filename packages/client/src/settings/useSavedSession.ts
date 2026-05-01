/**
 * Saved-session blob — last persisted snapshot of terminals + active id, or
 * null when no session is saved.
 *
 * Read-only singleton subscription. The server writes via the debounced
 * autosave loop driven by `terminals:dirty`. Before #577 the client only
 * saw session changes piggybacked on unrelated state events; now every
 * session-content write publishes on its own dedicated channel so the
 * `useSessionRestore` reactive recovery path stays fresh.
 *
 * Implemented via `useCell` from `@kolu/cells/solid` (server-authority mode).
 */

import { useCell } from "@kolu/cells/solid";
import type { SavedSession } from "kolu-common";
import { savedSessionCell } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { client } from "../wire";

const cell = useCell(savedSessionCell, {
  source: client.session.get,
  onError: (err) =>
    toast.error(`Saved-session subscription error: ${err.message}`),
});

export function useSavedSession() {
  return {
    sub: cell.sub,
    /** The persisted saved-session, or null when none exists or the
     *  subscription hasn't yielded yet. */
    savedSession: (): SavedSession | null => cell.value() ?? null,
  } as const;
}
