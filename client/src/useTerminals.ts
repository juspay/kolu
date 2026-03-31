/** Terminal session state — thin composition shell.
 *
 *  ARCHITECTURE: This file wires together focused modules:
 *    - useTerminalStore.ts    — TanStack live queries + client view state
 *    - useTerminalCrud.ts     — create, kill, close-all, theme, reorder, copy
 *    - useSessionRestore.ts   — queries, hydration, session restore
 *    - useWorktreeOps.ts      — worktree create/remove
 *    - useTerminalAlerts.ts   — Claude state detection (watches TanStack metadata)
 *  New features should go in the appropriate module (or a new one),
 *  not back into this composition root. See #221, #242. */

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { client } from "./rpc";
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
    markAttention: store.markAttention,
    terminalIds: store.terminalIds,
    terminalLabel: store.terminalLabel,
  });

  /** Subscribe to exit events for a terminal (one-shot action, not queryable state). */
  function subscribeExit(id: TerminalId) {
    (async () => {
      try {
        const stream = await client.terminal.onExit({ id });
        for await (const code of stream) {
          const label = store.terminalLabel(id);
          toast(
            code === 0
              ? `${label} exited`
              : `${label} exited with code ${code}`,
          );
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
