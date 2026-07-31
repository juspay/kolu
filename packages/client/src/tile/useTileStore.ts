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
 *  Today every tile's content is `{ kind: "terminal" }`, so the registry is a
 *  thin PROJECTION over the terminal store: `tileIds()` re-exposes the
 *  stabilized `terminalIds()` memo verbatim, and the selection signals still
 *  physically live in `useViewState` and are re-exposed here. That re-exposure
 *  is deliberate sequencing — the same call the note makes for layout (it stays
 *  a field on `TerminalMetadata`; the registry only HIDES where it lives). The
 *  payoff is the load-bearing one: PR 2 adds a `sleeping` content variant here
 *  and it inherits drag, resize, focus, active, dock ordering, and persistence
 *  for free, because every one of those operates on this content-agnostic
 *  registry rather than on the live terminal list.
 *
 *  Singleton via `createSharedRoot` (like `useTerminalStore` / `useDockOrder`)
 *  so every consumer shares one reactive owner rooted at the app, not at
 *  whichever component calls `useTileStore()` first. */

import { activeArm } from "@kolu/padi/surface";
import { createMemo } from "solid-js";
import { derivedTileSize, layoutTree } from "../canvas/layoutTree";
import type { TileLayout } from "../canvas/TileLayout";
import { createSharedRoot } from "../createSharedRoot";
import { persistCanvasLayout } from "../terminal/persistCanvasLayout";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { TileContent, TileId } from "./tileContent";

export const useTileStore = createSharedRoot(() => {
  const store = useTerminalStore();

  /** The ordered tile ids — the canvas `<For>` source and the dock/switcher
   *  set. Re-exposes the terminal store's stabilized `terminalIds()` memo
   *  VERBATIM (TileId === TerminalId), so the `sameTerminalIdOrder`
   *  reference-stability keystone (#1425) is inherited rather than
   *  re-implemented: a metadata-only tick that leaves the tile set unchanged
   *  still does NOT notify the canvas / dock / mode. PR 2 merges sleeping tile
   *  ids in here behind an equivalent equals gate. */
  const tileIds: () => TileId[] = store.terminalIds;

  /** Tile count — the single fact `mode()` (canvas-vs-maximized) and the
   *  empty-vs-workspace surface decision key off. Today === `terminalIds.length`;
   *  PR 2 counts sleeping tiles too, so a sleeping-only workspace stays on the
   *  canvas instead of collapsing to the empty state. */
  const tileCount = (): number => tileIds().length;

  /** Per-tile content lookup, dispatched on by the canvas/dock. The single
   *  per-id projection: a present id maps to its `terminal` content (the only
   *  kind today), an absent one to `undefined`. PR 2 makes this the one dispatch
   *  site where a sleeping id resolves to its own content kind. */
  const contentOf = (id: TileId): TileContent | undefined =>
    tileIds().includes(id) ? { kind: "terminal", terminalId: id } : undefined;

  /** A tile's MANUAL PIN — the position a human dragged it to, or nothing.
   *
   *  `canvasLayout` present ⇔ pinned is the whole rule: there is no
   *  `layoutMode` flag to keep in sync and no "Autoarrange" command to undo a
   *  hand placement, because auto-arrangement is the resting state rather than
   *  an action. A tile the user has never moved simply has no pin and takes
   *  its place from the tree.
   *
   *  The registry HIDES where a pin lives: for a terminal tile it reads
   *  `TerminalMetadata.canvasLayout`. */
  const pinnedLayout = (id: TileId): TileLayout | undefined => {
    const content = contentOf(id);
    if (content?.kind !== "terminal") return undefined;
    return store.getMetadata(content.terminalId)?.canvasLayout;
  };

  /** Where the tree puts every unpinned tile. A memo because the canvas's
   *  `layoutOf`, the minimap, the edge overlay and the focus camera all read
   *  it — one walk per invalidation instead of one per reader. */
  const derivedLayouts = createMemo(() =>
    layoutTree(
      tileIds().map((id) => ({
        id,
        parentId: store.getMetadata(id)?.parentId as TileId | undefined,
      })),
      pinnedLayout,
      (id) => derivedTileSize(activeArm(store.getMetadata(id))?.agent != null),
    ),
  );

  /** A tile's effective position/size: its pin if it has one, otherwise the
   *  box the tree derives for it. Callers (canvas, arrange, the switcher)
   *  neither know nor care which of the two answered. */
  const getLayout = (id: TileId): TileLayout | undefined =>
    pinnedLayout(id) ?? derivedLayouts().get(id);

  /** Persist a tile's position/size — the single tile-layout write seam.
   *  Dispatches by content kind to the right sink: today `persistCanvasLayout`
   *  on the terminal; PR 2 writes a sleeping tile's layout to its record. */
  const setLayout = (id: TileId, layout: TileLayout): void => {
    const content = contentOf(id);
    // A persist for an id that isn't a tile is a caller bug — every write flows
    // from a rendered tile whose id is in `tileIds()` by construction — so
    // surface it loudly rather than dropping the layout into the void (fail
    // fast; don't let a write silently collapse to a no-op). Distinct from the
    // kind dispatch below, which is a legitimate quiet branch for PR 2.
    if (!content) {
      console.error("useTileStore.setLayout: no tile for id", id);
      return;
    }
    if (content.kind !== "terminal") return;
    persistCanvasLayout(content.terminalId, layout);
  };

  /** Explicit tile-identity landing: a top-level terminal tile denotes its main
   *  pane, so no remembered split may override the id the caller supplied. */
  const activate = (id: TileId | null): void => {
    if (id === null) {
      store.activate(null);
      return;
    }
    store.focusMainTerminal(id);
  };

  return {
    // Tile presence + content.
    tileIds,
    tileCount,
    contentOf,
    // Layout — the registry hides the storage home (terminal metadata today)
    // and the pin-vs-derived split.
    getLayout,
    pinnedLayout,
    derivedLayouts,
    setLayout,
    // Selection — re-exposed from view state (one source of truth). The
    // active TILE may be any content kind; a terminal-content consumer that
    // needs the active TERMINAL keeps reading `store.activeId()` (identical
    // today — PR 2 narrows via `focusedId` once a sleeping tile can be
    // active). Physically relocating these signals into the
    // registry is a later optional migration, deferred like the layout-home
    // schema move. `TileId === TerminalId`, so these are already tile-typed.
    activeId: store.activeId,
    isFocused: store.isFocused,
    isActiveTile: store.isActiveTile,
    activate,
    /** Tile-level/system landing with no explicit pane target. */
    activateVisiblePane: store.activate,
    setActiveSilently: store.setActiveSilently,
  };
});

export type TileStore = ReturnType<typeof useTileStore>;
