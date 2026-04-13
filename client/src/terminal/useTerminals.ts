/** Terminal session state — thin composition shell.
 *
 *  ARCHITECTURE: This file wires together focused modules:
 *    - useTerminalStore.ts    — live subscriptions + client view state
 *    - useTerminalCrud.ts     — create, kill, close-all, theme, reorder, copy
 *    - useSessionRestore.ts   — hydration, session restore
 *    - useWorktreeOps.ts      — worktree create/remove
 *    - useTerminalAlerts.ts   — Claude state detection (watches metadata subscriptions)
 *  New features should go in the appropriate module (or a new one),
 *  not back into this composition root. See #221, #242. */

import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { stream } from "../rpc/rpc";
import { isExpectedCleanupError } from "../rpc/streamCleanup";
import { useTerminalStore } from "./useTerminalStore";
import { useTerminalCrud } from "./useTerminalCrud";
import { useSessionRestore } from "./useSessionRestore";
import { useWorktreeOps } from "./useWorktreeOps";
import { useTerminalAlerts } from "./useTerminalAlerts";

export function useTerminals() {
  const store = useTerminalStore();

  const alerts = useTerminalAlerts({
    activeId: store.activeId,
    getMetadata: store.getMetadata,
    isUnread: store.isUnread,
    markUnread: store.markUnread,
    terminalIds: store.terminalIds,
    terminalLabel: store.terminalLabel,
  });

  /** Subscribe to exit events for a terminal (one-shot action, not queryable state).
   *
   *  Race: if the terminal exits while the socket is down, the retried
   *  re-subscribe throws `TerminalNotFoundError` (not retried, per
   *  shouldRetry in rpc.ts) and the exit toast is missed. The terminal
   *  itself is still removed via the list subscription in useTerminalStore,
   *  so correctness is preserved even if the toast is lost. */
  function subscribeExit(id: TerminalId) {
    (async () => {
      try {
        const iter = await stream.exit(id);
        for await (const code of iter) {
          const label = store.terminalLabel(id);
          if (code === 0) {
            toast(`${label} exited`);
          } else {
            toast.warning(`${label} exited with code ${code}`);
          }
          crud.removeAndAutoSwitch(id);
        }
      } catch (err) {
        // Non-cleanup errors land here — notably `TerminalNotFoundError`
        // from a server-restart re-subscribe. Log so it's diagnosable.
        if (!isExpectedCleanupError(err)) {
          console.error("Exit stream error:", err);
        }
      }
    })();
  }

  const crud = useTerminalCrud({
    store,
    subscribeExit,
  });

  const session = useSessionRestore({
    store,
    subscribeExit,
    handleCreate: crud.handleCreate,
    handleCreateSubTerminal: crud.handleCreateSubTerminal,
  });

  const worktree = useWorktreeOps({
    store,
    handleCreate: crud.handleCreate,
    handleKill: crud.handleKill,
  });

  return { store, crud, session, worktree, alerts };
}
