import type { TileLayout } from "../canvas/TileLayout";
import { createSharedRoot } from "../createSharedRoot";
import { persistCanvasLayout } from "../terminal/persistCanvasLayout";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { TileContent, TileId } from "./tileContent";

export const useTileStore = createSharedRoot(() => {
  const store = useTerminalStore();

  /** The ordered tile ids — the canvas `<For>` source and the dock/switcher set. */
  const tileIds: () => TileId[] = store.terminalIds;

  /** Tile count. */
  const tileCount = (): number => tileIds().length;

  /** Per-tile content lookup, dispatched on by the canvas/dock. */
  const contentOf = (id: TileId): TileContent | undefined =>
    tileIds().includes(id) ? { kind: "terminal", terminalId: id } : undefined;

  /** A tile's saved position/size. */
  const getLayout = (id: TileId): TileLayout | undefined => {
    const content = contentOf(id);
    if (content?.kind !== "terminal") return undefined;
    return store.getMetadata(content.terminalId)?.canvasLayout;
  };

  /** Persist a tile's position/size. */
  const setLayout = (id: TileId, layout: TileLayout): void => {
    const content = contentOf(id);
    if (!content) {
      throw new Error(`useTileStore.setLayout: no tile for id ${id}`);
    }
    if (content.kind !== "terminal") return;
    persistCanvasLayout(content.terminalId, layout);
  };

  const activate = (id: TileId | null): void => {
    if (id === null) {
      store.activate(null);
      return;
    }
    store.focusMainTerminal(id);
  };

  return {
    tileIds,
    tileCount,
    contentOf,
    getLayout,
    setLayout,
    activeId: store.activeId,
    isFocused: store.isFocused,
    isActiveTile: store.isActiveTile,
    activate,
    activateVisiblePane: store.activate,
    setActiveSilently: store.setActiveSilently,
  };
});

export type TileStore = ReturnType<typeof useTileStore>;
