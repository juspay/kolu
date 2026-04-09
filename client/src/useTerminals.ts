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

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { client, STREAM_RETRY } from "./rpc";
import { useTerminalStore } from "./useTerminalStore";
import { useTerminalCrud } from "./useTerminalCrud";
import { useSessionRestore } from "./useSessionRestore";
import { useWorktreeOps } from "./useWorktreeOps";
import { useTerminalAlerts } from "./useTerminalAlerts";

export function useTerminals(deps: {
  randomTheme: Accessor<boolean>;
  activityAlerts: Accessor<boolean>;
}) {
  const store = useTerminalStore();

  const alerts = useTerminalAlerts({
    activityAlerts: deps.activityAlerts,
    activeId: store.activeId,
    getMetadata: store.getMetadata,
    markUnread: store.markUnread,
    terminalIds: store.terminalIds,
    terminalLabel: store.terminalLabel,
  });

  /** Subscribe to exit events for a terminal (one-shot action, not queryable state).
   *  Uses STREAM_RETRY so the subscription survives WebSocket reconnects.
   *  Race: if the terminal exits while the socket is down, the retried
   *  re-subscribe throws TerminalNotFoundError (not retried, per shouldRetry),
   *  and the exit toast is missed — the terminal itself is still removed via
   *  the list subscription in useTerminalStore. Acceptable; correctness is
   *  preserved even if one toast is lost. */
  function subscribeExit(id: TerminalId) {
    (async () => {
      try {
        const stream = await client.terminal.onExit(
          { id },
          { context: STREAM_RETRY },
        );
        for await (const code of stream) {
          const label = store.terminalLabel(id);
          if (code === 0) {
            toast(`${label} exited`);
          } else {
            toast.warning(`${label} exited with code ${code}`);
          }
          crud.removeAndAutoSwitch(id);
        }
      } catch {
        // Stream aborted or terminal gone — expected on cleanup
      }
    })();
  }

  const crud = useTerminalCrud({
    store,
    randomTheme: deps.randomTheme,
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
