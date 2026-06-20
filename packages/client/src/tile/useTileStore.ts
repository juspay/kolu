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

import {
  isRootedSleepingRecord,
  type SleepingTerminal,
  type TerminalMetadata,
  topTerminal,
} from "kolu-common/surface";
import { createMemo } from "solid-js";
import {
  type DockRowData,
  sleepingDockRowData,
} from "../canvas/dock/sleepingDockRow";
import type { TileLayout } from "../canvas/TileLayout";
import { createSharedRoot } from "../createSharedRoot";
import { persistCanvasLayout } from "../terminal/persistCanvasLayout";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import { sameTerminalIdOrder } from "../terminal/terminalIdOrder";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { sleepingTerminals } from "../wire";
import { persistSleepingLayout } from "./persistSleepingLayout";
import type { TileContent, TileId } from "./tileContent";
import { useWakingTiles } from "./wakingTiles";

export const useTileStore = createSharedRoot(() => {
  const store = useTerminalStore();
  const wakingTiles = useWakingTiles();

  /** Sleeping records safe to render: the server already drops orphans (no root
   *  terminal) via `getSleepingTerminals`, but skip any that slip through so a
   *  single corrupt record can never become a tile or reach the throwing
   *  `topTerminal` — graceful degradation, not a poisoned feature (the data-loss
   *  bug where every sleep "vanished"). */
  const sleepingRecords = (): SleepingTerminal[] =>
    sleepingTerminals().filter(isRootedSleepingRecord);

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
    return sleepingRecords()
      .map((r) => r.id as TileId)
      .filter((id) => !live.has(id) && !waking.has(id));
  };

  /** Each sleeping record projected to its dock-row `{ meta, info }`, memoized by
   *  the sleeping cell so the synthesis (`buildTerminalDisplayInfos` per record)
   *  runs once per sleeping-set change — not per dock render, per call site. The
   *  ONE home of "a sleeping tile's synthesized row data": `getMetadata` and
   *  `getDisplayInfo` both read it, and the dock reads them, so the live-else-
   *  synthesize merge lives here alone instead of at three hand-rolled sites. */
  const sleepingRowData = createMemo<Map<TileId, DockRowData>>(() => {
    const map = new Map<TileId, DockRowData>();
    for (const record of sleepingRecords()) {
      const data = sleepingDockRowData(record);
      if (data) map.set(record.id as TileId, data);
    }
    return map;
  });

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
    const record = sleepingRecords().find((r) => r.id === id);
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
      return topTerminal(content.record).canvasLayout;
    }
    return undefined;
  };

  /** A tile's metadata — live from the terminal store, or synthesized from the
   *  sleeping record so the dock can rank/group a dormant tile through the same
   *  pipeline (`rankDockRows` reads `meta.agent` / `meta.lastActivityAt`). Live
   *  wins for a shared id during the sleep window (the store is consulted first). */
  const getMetadata = (id: TileId): TerminalMetadata | undefined =>
    store.getMetadata(id) ?? sleepingRowData().get(id)?.meta;

  /** A tile's display info — the `{ key, meta, repoColor, … }` row shape the
   *  switcher / workspace grid / dock render. Live for a terminal tile; for a
   *  sleeping tile the SAME shape synthesized from its record. This is the one
   *  reason the workspace switcher can list a sleeping-only workspace —
   *  `store.getDisplayInfo` alone knows only live terminals. */
  const getDisplayInfo = (id: TileId): TerminalDisplayInfo | undefined =>
    store.getDisplayInfo(id) ?? sleepingRowData().get(id)?.info;

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
    // Tile-aware metadata + display info — live for terminal tiles, synthesized
    // from the record for sleeping ones (the dock ranks/groups through these, and
    // the workspace switcher can list a sleeping-only workspace). The one home of
    // the live-else-synthesize merge.
    getMetadata,
    getDisplayInfo,
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
