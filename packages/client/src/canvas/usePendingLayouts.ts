import type { TerminalId } from "kolu-common/surface";
import { produce, reconcile } from "solid-js/store";
import {
  hostIndependentSignal,
  hostIndependentStore,
} from "../hostScope/hostIndependent";
import { layoutsEqual, type TileLayout } from "./TileLayout";

const [pending, setPending] = hostIndependentStore<Record<string, TileLayout>>(
  {},
);

const [nextDefaultSize, setNextSizeSignal] = hostIndependentSignal<{
  w: number;
  h: number;
} | null>(null);

const HISTORY_LIMIT = 32;
if (typeof window !== "undefined") {
  window.__koluPendingApplyHistory = [];
}

export function usePendingLayouts(): {
  pending: Record<string, TileLayout>;
  setOne: (id: TerminalId, layout: TileLayout) => void;
  resolveLayout: (
    id: TerminalId,
    echoed: TileLayout | undefined,
  ) => TileLayout | undefined;
  applyMany: (layouts: Map<TerminalId, TileLayout>) => void;
  dropEvicted: (
    alive: Set<TerminalId>,
    saved: (id: TerminalId) => TileLayout | undefined,
  ) => void;
  clear: () => void;
  setNextDefaultSize: (size: { w: number; h: number } | null) => void;
  takeNextDefaultSize: () => { w: number; h: number } | null;
} {
  return {
    get pending() {
      return pending;
    },
    setOne(id, layout) {
      setPending(id, layout);
    },
    resolveLayout(id, echoed) {
      return pending[id] ?? echoed;
    },
    applyMany(layouts) {
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          for (const [id, layout] of layouts) draft[id] = layout;
        }),
      );
      if (typeof window !== "undefined") {
        const history = window.__koluPendingApplyHistory;
        if (history) {
          history.push([...layouts.keys()]);
          if (history.length > HISTORY_LIMIT) history.shift();
        }
      }
    },
    dropEvicted(alive, saved) {
      if (Object.keys(pending).length === 0) return;
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          for (const id of Object.keys(draft)) {
            const entry = draft[id];
            if (!alive.has(id)) {
              delete draft[id];
              continue;
            }
            const current = saved(id);
            if (entry && current && layoutsEqual(current, entry)) {
              delete draft[id];
            }
          }
        }),
      );
    },
    clear() {
      setPending(reconcile({}));
      setNextSizeSignal(null);
    },
    setNextDefaultSize(size) {
      setNextSizeSignal(size);
    },
    takeNextDefaultSize() {
      const size = nextDefaultSize();
      setNextSizeSignal(null);
      return size;
    },
  };
}
