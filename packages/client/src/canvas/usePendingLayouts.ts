/** Pending tile layouts — the bridge between local geometry intent
 *  (drag-end, resize-end, default-place, arrange) and server metadata
 *  echoes. Multiple consumers need access:
 *
 *  - `TerminalCanvas` reads pending in `layoutOf()`, drops echoed
 *    entries via `dropEvicted` once the saved layout catches up, and
 *    flushes everything via `clear()` on its own unmount so a
 *    mobile↔desktop remount never carries stale entries forward.
 *  - `useCanvasArrange` seeds pending in `handleCanvasAutoArrange` so
 *    a follow-on `placeNew` (e.g. user opens a new worktree right
 *    after arrange) reads the arranged layouts in `existing` instead
 *    of the still-saved pre-arrange ones — the metadata round-trip
 *    hasn't completed yet.
 *
 *  Singleton hook per `.claude/rules/solidjs.md`'s "State per domain"
 *  rule. `createStore` (per the same rule, "use createStore over
 *  createSignal<Record> for keyed state") gives fine-grained per-key
 *  reactivity so a single `setOne` doesn't invalidate every consumer
 *  that reads a different key. */

import type { TerminalId } from "kolu-common/surface";
import { createStore, produce } from "solid-js/store";
import { layoutsEqual, type TileLayout } from "./TileLayout";

const [pending, setPending] = createStore<Record<string, TileLayout>>({});

// E2e test hook — exposes a snapshot getter so step defs can assert
// pending was seeded synchronously by arrange (catching the
// pre-arrange layout race that a polled tile-position assertion would
// miss because echoes arrive within the polling window). See
// `kolu-common/test-hooks`.
if (typeof window !== "undefined") {
  window.__koluPendingLayouts = () => ({ ...pending });
}

export function usePendingLayouts(): {
  /** Read the current pending record. Reactive — consumers depending
   *  on a specific key only re-run when that key changes (createStore
   *  fine-grained tracking). */
  pending: Record<string, TileLayout>;
  /** Set or update a single tile's pending override. */
  setOne: (id: TerminalId, layout: TileLayout) => void;
  /** Bulk-apply pending overrides (used by arrange). */
  applyMany: (layouts: Map<TerminalId, TileLayout>) => void;
  /** Drop entries for tiles that are no longer alive OR whose saved
   *  layout has caught up to their pending value. The cleanup policy
   *  lives inside the module — callers don't reconstruct it. */
  dropEvicted: (
    alive: Set<TerminalId>,
    saved: (id: TerminalId) => TileLayout | undefined,
  ) => void;
  /** Wipe all pending entries. Called on canvas unmount so a remount
   *  starts from a clean slate. */
  clear: () => void;
} {
  return {
    get pending() {
      return pending;
    },
    setOne(id, layout) {
      setPending(id, layout);
    },
    applyMany(layouts) {
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          for (const [id, layout] of layouts) draft[id] = layout;
        }),
      );
    },
    dropEvicted(alive, saved) {
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
      setPending(
        produce((draft: Record<string, TileLayout>) => {
          for (const id of Object.keys(draft)) delete draft[id];
        }),
      );
    },
  };
}
