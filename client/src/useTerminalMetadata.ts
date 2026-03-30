/** Terminal metadata — TanStack live queries for server-derived state.
 *  One metadata stream per terminal. SolidJS fine-grained reactivity
 *  handles per-field updates automatically.
 *  Order is derived from metadata sortOrder — no separate ordering state. */

import { type Accessor, createEffect, on, createMemo } from "solid-js";
import { createQueries } from "@tanstack/solid-query";
import type { TerminalId, TerminalMetadata, ActivitySample } from "kolu-common";
import { orpc } from "./orpc";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

export function useTerminalMetadata(deps: {
  knownIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
  getActivityHistory: (id: TerminalId) => ActivitySample[];
  pushActivity: (id: TerminalId, active: boolean) => void;
}) {
  const metadataQueries = createQueries(() => ({
    queries: deps.knownIds().map((id) =>
      orpc.terminal.onMetadataChange.experimental_liveOptions({
        input: { id },
      }),
    ),
  }));

  /** Get server metadata for a terminal from TanStack cache. */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const idx = deps.knownIds().indexOf(id);
    return idx >= 0 ? metadataQueries[idx]?.data : undefined;
  }

  // --- Order derived from metadata sortOrder ---

  /** Top-level terminal IDs sorted by sortOrder.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading). */
  const terminalIds = createMemo(() =>
    deps.knownIds()
      .filter((id) => { const m = getMetadata(id); return m && !m.parentId; })
      .sort((a, b) => (getMetadata(a)?.sortOrder ?? 0) - (getMetadata(b)?.sortOrder ?? 0)),
  );

  /** Sub-terminal IDs for a parent, sorted by sortOrder. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return deps.knownIds()
      .filter((id) => getMetadata(id)?.parentId === parentId)
      .sort((a, b) => (getMetadata(a)?.sortOrder ?? 0) - (getMetadata(b)?.sortOrder ?? 0));
  }

  // --- Activity fold ---

  createEffect(
    on(
      () => deps.knownIds().map((id) => getMetadata(id)?.busy),
      (busyStates, prevStates) => {
        const ids = deps.knownIds();
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

  // --- Derived accessors ---

  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = deps.activeId();
    return id !== null ? (getMetadata(id) ?? null) : null;
  });

  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      terminalIds(),
      (id) => ({ meta: getMetadata(id) }),
      deps.getActivityHistory,
      getSubTerminalIds,
    ),
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos().get(id);
  }

  /** Human-readable label for a terminal by its sidebar position. */
  function terminalLabel(id: TerminalId): string {
    const pos = terminalIds().indexOf(id) + 1;
    return pos > 0 ? `Terminal ${pos}` : "Terminal";
  }

  return {
    getMetadata,
    terminalIds,
    getSubTerminalIds,
    activeMeta,
    getDisplayInfo,
    terminalLabel,
  };
}
