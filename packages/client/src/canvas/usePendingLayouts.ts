/** Pending tile layouts — the bridge between local geometry intent
 *  (drag-end, resize-end, default-place, arrange) and server metadata
 *  echoes. Multiple consumers need access:
 *
 *  - `TerminalCanvas` reads pending in `layoutOf()` and runs the
 *    auto-cleanup effect that drops entries when the saved layout
 *    catches up to the pending value.
 *  - `useCanvasArrange` seeds pending in `handleCanvasAutoArrange` so
 *    a follow-on `placeNew` (e.g. user opens a new worktree right
 *    after arrange) reads the arranged layouts in `existing` instead
 *    of the still-saved pre-arrange ones — the metadata round-trip
 *    hasn't completed yet.
 *
 *  Singleton hook per `.claude/rules/solidjs.md`'s "State per domain"
 *  rule. No imperative ref dance required to share state across the
 *  canvas/arrange split. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createSignal } from "solid-js";
import type { TileLayout } from "./TileLayout";

const [pending, setPending] = createSignal<Record<string, TileLayout>>({});

let initialized = false;
function init() {
  if (initialized) return;
  initialized = true;
  // E2e test hook — exposes a snapshot getter so step defs can assert
  // pending was seeded synchronously by arrange (catching the
  // pre-arrange layout race that a polled tile-position assertion would
  // miss because echoes arrive within the polling window). See
  // `kolu-common/test-hooks`.
  if (typeof window !== "undefined") {
    window.__koluPendingLayouts = () => ({ ...pending() });
  }
}

export function usePendingLayouts(): {
  pending: Accessor<Record<string, TileLayout>>;
  setOne: (id: TerminalId, layout: TileLayout) => void;
  applyMany: (layouts: Map<TerminalId, TileLayout>) => void;
  /** Replace the entire pending record (used by the auto-cleanup
   *  effect inside `TerminalCanvas` that drops echoed entries). */
  replace: (next: Record<string, TileLayout>) => void;
} {
  init();
  return {
    pending,
    setOne(id, layout) {
      setPending((prev) => ({ ...prev, [id]: layout }));
    },
    applyMany(layouts) {
      setPending((prev) => {
        const next = { ...prev };
        for (const [id, layout] of layouts) next[id] = layout;
        return next;
      });
    },
    replace(next) {
      setPending(next);
    },
  };
}
