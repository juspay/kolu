/** Terminal streams — server event subscriptions for metadata, activity, and exit via TanStack Query. */

import { createRoot, createEffect, on } from "solid-js";
import { createQuery } from "@tanstack/solid-query";
import { orpc } from "./queryClient";
import type { TerminalId } from "kolu-common";
import type { TerminalMetaStore, SetTerminalMeta } from "./useTerminalStore";

export function useTerminalStreams(deps: {
  meta: TerminalMetaStore;
  setMeta: SetTerminalMeta;
  pushActivity: (id: TerminalId, active: boolean) => void;
  onExit: (id: TerminalId, code: number) => void;
  onClaudeStateChange: (
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) => void;
}) {
  /** Start all per-terminal stream subscriptions (metadata, activity, exit). */
  function subscribeAll(id: TerminalId) {
    // createRoot provides a reactive owner for queries created imperatively
    createRoot(() => {
      // Metadata stream
      const metaQuery = createQuery(() =>
        orpc.terminal.onMetadataChange.experimental_liveOptions({
          input: { id },
          retry: true,
        }),
      );
      createEffect(
        on(
          () => metaQuery.data,
          (metadata) => {
            if (!metadata) return;
            const prevState = deps.meta[id]?.meta?.claude?.state;
            deps.setMeta(id, "meta", metadata);
            deps.onClaudeStateChange(id, prevState, metadata.claude?.state);
          },
          { defer: true },
        ),
      );

      // Activity stream
      const activityQuery = createQuery(() =>
        orpc.terminal.onActivityChange.experimental_liveOptions({
          input: { id },
          retry: true,
        }),
      );
      createEffect(
        on(
          () => activityQuery.data,
          (isActive) => {
            if (isActive === undefined) return;
            deps.setMeta(id, "isActive", isActive);
            deps.pushActivity(id, isActive);
          },
          { defer: true },
        ),
      );

      // Exit stream
      const exitQuery = createQuery(() =>
        orpc.terminal.onExit.experimental_liveOptions({
          input: { id },
          retry: false, // Don't retry exit — terminal is gone
        }),
      );
      createEffect(
        on(
          () => exitQuery.data,
          (code) => {
            if (code === undefined) return;
            deps.onExit(id, code);
          },
          { defer: true },
        ),
      );
    });
  }

  return { subscribeAll };
}
