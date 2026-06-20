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
  const contentOf = (id: TileId): TileContent | undefined => {
    const meta = store.getMetadata(id);
    if (!meta) return undefined;
    return meta.state === "sleeping"
      ? { kind: "sleeping", terminalId: id }
      : { kind: "terminal", terminalId: id };
  };

  /** A tile's saved position/size. The registry HIDES where layout lives: for a
   *  terminal tile it reads `TerminalMetadata.canvasLayout` (no schema change —
   *  the note's lowy sequencing); PR 2's sleeping arm reads layout off the
   *  sleeping record. Callers (canvas `getLayout`, arrange, the switcher) stop
   *  knowing layout is a field on the terminal. */
  const getLayout = (id: TileId): TileLayout | undefined => {
    const content = contentOf(id);
    if (!content) return undefined;
    // Both arms read `canvasLayout` off the same persisted base — only the
    // content-kind guard differs (a sleeping record carries its frozen layout
    // so the tile keeps its position across a sleep).
    return store.getMetadata(content.terminalId)?.canvasLayout;
  };

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
