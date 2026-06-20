/** Tile registry — the first-class "what tiles exist, which is active, where
 *  each sits" layer the canvas, dock, and selection read. It sits IN FRONT OF
 *  the terminal store (fed by it), separating tile PRESENCE from terminal
 *  LIVENESS:
 *
 *    The Tile owns      → identity (TileId), the TileContent union, canvas
 *                         layout access, active/selection, tile count.
 *    The Terminal owns  → PTY · xterm · agent · attach stream · repo/branch
 *                         identity · the live body (getMetadata / getDisplayInfo
 *                         / focusedId).
 *
 *  A tile's content is `terminal` (live) or `sleeping` (PTY-released, frozen).
 *  `tileIds()` is the DEDUPED union of the live terminal list and the sleeping
 *  records (live wins for a shared id); `contentOf(id)` dispatches a tile to its
 *  kind. Both the terminal layout (a field on `TerminalMetadata`) and the
 *  selection signals (in `useViewState`) still physically live where they did —
 *  the registry only HIDES that, so a sleeping tile inherits drag, resize,
 *  focus, active, dock ordering, and persistence for free, because every one of
 *  those operates on this content-agnostic registry rather than on either
 *  underlying list. That is the whole payoff of the decomplect: sleeping is a
 *  content variant, not a parallel silo.
 *
 *  Singleton via `createSharedRoot` (like `useTerminalStore` / `useDockOrder`)
 *  so every consumer shares one reactive owner rooted at the app, not at
 *  whichever component calls `useTileStore()` first. */

import { createMemo } from "solid-js";
import type { TileLayout } from "../canvas/TileLayout";
import { createSharedRoot } from "../createSharedRoot";
import { persistCanvasLayout } from "../terminal/persistCanvasLayout";
import { sameTerminalIdOrder } from "../terminal/terminalIdOrder";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { sleepingTerminals } from "../wire";
import { persistSleepingLayout } from "./persistSleepingLayout";
import type { TileContent, TileId } from "./tileContent";
import { useWakingTiles } from "./wakingTiles";

export const useTileStore = createSharedRoot(() => {
  const store = useTerminalStore();
  const wakingTiles = useWakingTiles();

  /** Sleeping records to actually surface as tiles, by id. Two records are
   *  filtered out — the single home of the "live wins over sleeping" rule:
   *   - mid-wake (the `wakingTiles` optimistic hide): the record lingers until
   *     the server drops it, but its freshly-respawned live tile already shows,
   *     so hide the stale dormant one to avoid a beat of overlap;
   *   - still live (the brief sleep persist→kill window): the record exists but
   *     its terminal hasn't been killed yet, so the LIVE tile wins and the
   *     sleeping id is suppressed from the union. */
  const sleepingTileIds = (): TileId[] => {
    const live = new Set<TileId>(store.terminalIds());
    const waking = wakingTiles.waking();
    return sleepingTerminals()
      .map((r) => r.id as TileId)
      .filter((id) => !live.has(id) && !waking.has(id));
  };

  /** The ordered tile ids — the canvas `<For>` source and the dock/switcher
   *  set: live terminals first, then sleeping records (a deduped union, live
   *  wins). Wrapped in a memo gated on `sameTerminalIdOrder` (TileId ===
   *  TerminalId, identical comparison) so the #1425 reference-stability keystone
   *  survives the merge — a metadata-only tick that leaves the tile set + order
   *  unchanged returns the PRIOR array reference and does NOT notify the canvas /
   *  dock / mode. `store.terminalIds` is itself such a memo, so this composes two
   *  stable references into one. */
  const tileIds = createMemo<TileId[]>(
    () => [...store.terminalIds(), ...sleepingTileIds()],
    [],
    { equals: sameTerminalIdOrder },
  );

  /** Tile count — the single fact `mode()` (canvas-vs-maximized) and the
   *  empty-vs-workspace surface decision key off. Sleeping tiles count (they're
   *  already in `tileIds()`), so a sleeping-only workspace stays on the canvas
   *  instead of collapsing to the empty state — and reading the merged
   *  `tileIds()` avoids the two-registry `live + sleeping.length` over-count. */
  const tileCount = (): number => tileIds().length;

  /** Per-tile content lookup, dispatched on by the canvas/dock. Live wins: an id
   *  that is a live terminal resolves to `terminal` content even while a sleeping
   *  record with the same id still exists (the sleep window). Otherwise a
   *  matching sleeping record resolves to `sleeping`; an unknown id to
   *  `undefined`. The sleeping record is keyed by the original top-terminal id
   *  (=== this `TileId`), so the lookup is a direct `r.id === id`. */
  const contentOf = (id: TileId): TileContent | undefined => {
    if (store.terminalIds().includes(id)) {
      return { kind: "terminal", terminalId: id };
    }
    const record = sleepingTerminals().find((r) => r.id === id);
    return record ? { kind: "sleeping", record } : undefined;
  };

  /** A tile's saved position/size. The registry HIDES where layout lives: a
   *  terminal tile reads `TerminalMetadata.canvasLayout`, a sleeping tile reads
   *  it off the record's top terminal. Callers (canvas `getLayout`, arrange, the
   *  switcher) stop knowing where layout is stored. */
  const getLayout = (id: TileId): TileLayout | undefined => {
    const content = contentOf(id);
    if (content?.kind === "terminal") {
      return store.getMetadata(content.terminalId)?.canvasLayout;
    }
    if (content?.kind === "sleeping") {
      return content.record.terminals.find((t) => !t.parentId)?.canvasLayout;
    }
    return undefined;
  };

  /** Persist a tile's position/size — the single tile-layout write seam.
   *  Dispatches by content kind to the right LEAF sink: `persistCanvasLayout` on
   *  the terminal, or `persistSleepingLayout` on the sleeping record (both keyed
   *  by this `TileId`). */
  const setLayout = (id: TileId, layout: TileLayout): void => {
    const content = contentOf(id);
    // A persist for an id that isn't a tile is a caller bug — every write flows
    // from a rendered tile whose id is in `tileIds()` by construction — so
    // surface it loudly rather than dropping the layout into the void (fail
    // fast; don't let a write silently collapse to a no-op).
    if (!content) {
      console.error("useTileStore.setLayout: no tile for id", id);
      return;
    }
    if (content.kind === "terminal") {
      persistCanvasLayout(content.terminalId, layout);
      return;
    }
    persistSleepingLayout(id, layout);
  };

  return {
    // Tile presence + content.
    tileIds,
    tileCount,
    contentOf,
    // Layout — the registry hides the storage home (terminal metadata today).
    getLayout,
    setLayout,
    // Selection — re-exposed from view state (one source of truth). The
    // active TILE may be any content kind; a terminal-content consumer that
    // needs the active TERMINAL keeps reading `store.activeId()` (identical
    // today — PR 2 narrows via `focusedId` once a sleeping tile can be
    // active). Physically relocating these signals into the
    // registry is a later optional migration, deferred like the layout-home
    // schema move. `TileId === TerminalId`, so these are already tile-typed.
    activeId: store.activeId,
    activate: store.activate,
    setActiveSilently: store.setActiveSilently,
  };
});

export type TileStore = ReturnType<typeof useTileStore>;
