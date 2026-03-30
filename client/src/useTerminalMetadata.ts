/** Terminal metadata — TanStack live queries for server-derived state.
 *  One metadata stream per terminal. SolidJS fine-grained reactivity
 *  handles per-field updates automatically. */

import { type Accessor, createEffect, on, createMemo } from "solid-js";
import { createQueries } from "@tanstack/solid-query";
import type { TerminalId, TerminalMetadata, ActivitySample } from "kolu-common";
import { orpc } from "./orpc";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

export function useTerminalMetadata(deps: {
  allTerminalIds: Accessor<TerminalId[]>;
  terminalIds: Accessor<TerminalId[]>;
  getSubTerminalIds: (parentId: TerminalId) => TerminalId[];
  activeId: Accessor<TerminalId | null>;
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  pushActivity: (id: TerminalId, active: boolean) => void;
}) {
  const metadataQueries = createQueries(() => ({
    queries: deps.allTerminalIds().map((id) =>
      orpc.terminal.onMetadataChange.experimental_liveOptions({
        input: { id },
      }),
    ),
  }));

  /** Get server metadata for a terminal from TanStack cache. */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const idx = deps.allTerminalIds().indexOf(id);
    return idx >= 0 ? metadataQueries[idx]?.data : undefined;
  }

  // Push activity transitions to the sparkline fold.
  // SolidJS's on() tracks previous values natively — no manual Map needed.
  createEffect(
    on(
      () => deps.allTerminalIds().map((id) => metadataQueries[deps.allTerminalIds().indexOf(id)]?.data?.busy),
      (busyStates, prevStates) => {
        const ids = deps.allTerminalIds();
        for (let i = 0; i < ids.length; i++) {
          const busy = busyStates[i];
          if (busy === undefined) continue;
          if (busy !== prevStates?.[i]) {
            deps.pushActivity(ids[i]!, busy);
          }
        }
      },
    ),
  );

  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = deps.activeId();
    return id !== null ? (getMetadata(id) ?? null) : null;
  });

  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      deps.terminalIds(),
      (id) => ({ meta: getMetadata(id) }),
      deps.getActivityHistory,
      deps.getSubTerminalIds,
    ),
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos().get(id);
  }

  return {
    getMetadata,
    activeMeta,
    getDisplayInfo,
  };
}
