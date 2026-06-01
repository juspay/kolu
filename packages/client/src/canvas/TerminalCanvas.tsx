/** TerminalCanvas — freeform 2D canvas where tiles can be dragged and resized
 *  like desktop windows. Pan via two-finger scroll / trackpad, zoom via
 *  Ctrl+scroll / pinch. Tiles snap to the visual grid on drag end.
 *
 *  The canvas is domain-agnostic — it manages tile positioning, drag, resize,
 *  pan, and zoom. What renders inside each tile (title bar content, body) is
 *  injected via render props by the caller. Positions are read via `getLayout`
 *  and changes are reported via `onLayoutChange` — the caller owns the
 *  source of truth (today: server metadata via subscription).
 *
 *  Drag uses @thisbeyond/solid-dnd (same library as the sidebar) for
 *  gesture handling — decouples sensing from position application.
 *
 *  Pan/zoom viewport logic lives in viewport/ — decomposed by volatility
 *  axis (gestures, transforms, coordinates) per Lowy analysis. */

import {
  DragDropProvider,
  DragDropSensors,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { useStaleCheck } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { savedSessionSub } from "../wire";
import CanvasMinimap from "./CanvasMinimap";
import CanvasTile, { type CanvasTileMode } from "./CanvasTile";
import CanvasWatermark from "./CanvasWatermark";
import Dock from "./dock/Dock";
import { applyResize, type ResizeDirection } from "./resizeGeometry";
import type { TileLayout } from "./TileLayout";
import {
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  findFreeTilePosition,
} from "./tilePlacement";
import { useCanvasFocus } from "./useCanvasFocus";
import { usePendingLayouts } from "./usePendingLayouts";
import { useTileTheme } from "./useTileTheme";
import { useViewPosture } from "./useViewPosture";
import { capturePointerGesture } from "./viewport/capturePointerGesture";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

const MIN_W = 300;
const MIN_H = 200;

/** Wheel gestures that start inside an xterm tile should scroll the terminal,
 *  not pan the canvas. The viewport's ownership tracker holds this decision
 *  for ~150ms so mid-gesture cursor drift doesn't hand off. */
function isWheelTargetTerminal(e: WheelEvent): boolean {
  return e.target instanceof Element && e.target.closest(".xterm") !== null;
}

const TerminalCanvas: Component<{
  tileIds: TerminalId[];
  /** Optional corner watermark (e.g. `kolu@host`) painted in the
   *  top-left of the canvas. Stays outside the pan/zoom transform so
   *  it reads as a fixed identity mark on the surface, not a tile. */
  watermark?: string;
  /** Saved layout for a tile, or undefined if none exists yet. */
  getLayout: (id: TerminalId) => TileLayout | undefined;
  /** Optional placement policy hook for new tiles. The canvas asks for a
   *  position; if the hook returns one it's used, otherwise the default
   *  cascade kicks in. `existing` is each currently-placed tile's
   *  effective layout (pending merged with saved) plus tiles that the
   *  same loop pass has just default-placed. The caller can't reconstruct
   *  this from its own store: pending overrides live only inside the
   *  canvas, and same-pass placements haven't round-tripped through the
   *  server yet.
   *
   *  Side-effect contract (despite the pure-query signature shape):
   *  the hook MAY mutate sibling layouts. Implementations that move
   *  siblings must seed the canvas's pending store and dispatch
   *  geometry RPCs for those siblings BEFORE returning, so the
   *  new-tile write that follows lands on top of an already-applied
   *  sibling layout. */
  placeNew?: (
    id: TerminalId,
    existing: { id: TerminalId; layout: TileLayout }[],
  ) => TileLayout | undefined;
  /** Optional one-shot arrange trigger. When provided, the minimap
   *  zoom-bar grows an arrange button. The canvas is just plumbing —
   *  the arrange logic itself lives in `useCanvasArrange`.
   *
   *  Threaded as a prop rather than consumed via a singleton hook
   *  (the way `useCanvasViewport` and `usePendingLayouts` are read
   *  inside `CanvasMinimap`) because `useCanvasArrange` takes
   *  composition-root deps (`{ store, crud }`) —
   *  it's a function, not a zero-arg singleton. The prop captures
   *  the bound result; the minimap doesn't know or care about the
   *  arrange policy. */
  onAutoArrange?: () => void;
  /** Report a layout change (drag commit, resize commit, default assignment). */
  onLayoutChange: (id: TerminalId, layout: TileLayout) => void;
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  /** Invoked when the dock's search-icon button is clicked. Opens the
   *  command palette pre-drilled into the "Search workspaces" group —
   *  the same surface `Mod+Shift+K` reaches. */
  onOpenWorkspaceSearch: () => void;
  /** Open the "new terminal" flow — wired into the dock header's `+`. */
  onCreate: () => void;
  renderTileTitle: (id: TerminalId) => JSX.Element;
  /** Optional title-bar actions injected between the title and the close
   *  button — e.g. the screenshot button, theme pill, agent indicator. */
  renderTileTitleActions?: (id: TerminalId) => JSX.Element;
  /** `active` is passed as an accessor so the subtree doesn't remount on
   *  every focus change — reads happen inside the returned JSX's props
   *  (fine-grained reactivity), not around the render-prop effect. */
  renderTileBody: (id: TerminalId, active: () => boolean) => JSX.Element;
}> = (props) => {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const focus = useCanvasFocus();
  const tileTheme = useTileTheme();
  const posture = useViewPosture();
  const isStale = useStaleCheck();

  /** Pending per-tile layout overrides — bridges the gap between local
   *  geometry intent (drag-end, resize-end, default-place, arrange) and
   *  the server metadata echo. Singleton hook so `useCanvasArrange` can
   *  seed pending for one-shot arrange writes without an imperative ref
   *  handshake. Entries auto-clear when the echoed layout matches
   *  (effect below). */
  const pendingLayouts = usePendingLayouts();
  const setPendingLayout = (id: string, layout: TileLayout) =>
    pendingLayouts.setOne(id, layout);

  // Drop pending entries for tiles that died OR whose echo caught up.
  // The cleanup policy itself lives inside `usePendingLayouts` so the
  // canvas only owns the trigger (tileIds + getLayout changes), not the
  // rule. `getLayout` is captured in a stable closure so SolidJS's
  // fine-grained tracking re-runs the effect when either input shifts.
  createEffect(() => {
    pendingLayouts.dropEvicted(new Set(props.tileIds), props.getLayout);
  });

  // Pending lives at module scope (singleton, shared with useCanvasArrange).
  // Flush on canvas unmount so a mobile↔desktop remount never inherits a
  // stale entry whose echo arrived while the canvas was gone.
  onCleanup(() => pendingLayouts.clear());

  /** Effective layout for a tile (pending override wins over saved). */
  function layoutOf(id: string): TileLayout | undefined {
    return pendingLayouts.pending[id] ?? props.getLayout(id);
  }

  /** Merged layouts keyed by tile ID — consumed by CanvasTile and CanvasMinimap. */
  const layouts = createMemo<Record<string, TileLayout>>(() => {
    const result: Record<string, TileLayout> = {};
    for (const id of props.tileIds) {
      const l = layoutOf(id);
      if (l) result[id] = l;
    }
    return result;
  });

  // Auto-assign a default layout for tiles with no saved position.
  // The pending seed makes the tile paint at the cascade position on its
  // first render — without it, there would be a (0,0) frame while waiting
  // for the server's metadata echo.
  //
  // Contract: the default-placement runs only for tiles whose `getLayout(id)`
  // is falsy on their first appearance in `tileIds`. Callers that intend
  // to preserve a pre-existing layout (session restore, tile clone, …) are
  // responsible for making `getLayout(id)` return it by then — e.g. by
  // seeding server metadata before the list snapshot yields (#642). Any
  // path that seeds AFTER the first `tileIds` fire will lose to this
  // effect and overwrite the intended layout.
  createEffect(
    on(
      () => props.tileIds,
      (ids) => {
        const { width, height } = viewport.viewportSize();
        const zoom = viewport.zoom();
        const cx = viewport.panX() + width / (2 * zoom);
        const cy = viewport.panY() + height / (2 * zoom);
        const placed: {
          id: TerminalId;
          layout: TileLayout;
          isNew: boolean;
        }[] = [];
        for (const id of ids) {
          const existing = layoutOf(id);
          if (existing) {
            placed.push({ id, layout: existing, isNew: false });
            continue;
          }
          const fromPolicy = props.placeNew?.(
            id,
            placed.map(({ id, layout }) => ({ id, layout })),
          );
          const defaultLayout: TileLayout = fromPolicy ?? {
            ...findFreeTilePosition(
              cx,
              cy,
              placed.map((p) => p.layout),
            ),
            w: DEFAULT_TILE_W,
            h: DEFAULT_TILE_H,
          };
          setPendingLayout(id, defaultLayout);
          props.onLayoutChange(id, defaultLayout);
          placed.push({ id, layout: defaultLayout, isNew: true });
        }
        // Pan to the active newly-placed tile. `activate` is a no-op
        // setter when active is already this id (handleCreate already set
        // it via setActiveSilently before the cascade ran) — the call's
        // job here is bumping the centering signal once the new tile's
        // pending layout exists. Same mechanism the `focus.request`
        // effect below uses for every other system-driven activation.
        const activeId = store.activeId();
        if (activeId && placed.some((p) => p.isNew && p.id === activeId)) {
          store.activate(activeId);
        }
      },
    ),
  );

  // solid-dnd resets the draggable transform before onDragEnd fires,
  // so we capture the last known delta during onDragMove.
  const [dragDelta, setDragDelta] = createSignal({ x: 0, y: 0 });

  function handleDragMove({ draggable }: DragEvent) {
    if (draggable)
      setDragDelta({ x: draggable.transform.x, y: draggable.transform.y });
  }

  /** Apply captured drag delta to the tile's persisted position.
   *  Delta is in screen-space — normalize by zoom for canvas-space. */
  function handleDragEnd({ draggable }: DragEvent) {
    if (!draggable) return;
    const id = draggable.id as string;
    const l = layoutOf(id);
    if (!l) return;
    const { x: sdx, y: sdy } = dragDelta();
    if (sdx !== 0 || sdy !== 0) {
      const { dx, dy } = viewport.normalizeDelta(sdx, sdy);
      const next: TileLayout = {
        ...l,
        x: viewport.snapToGrid(l.x + dx),
        y: viewport.snapToGrid(l.y + dy),
      };
      // Hold pending until metadata echo arrives — avoids a frame where
      // solid-dnd's transform has reset to 0 but getLayout still returns
      // the pre-drag position.
      setPendingLayout(id, next);
      props.onLayoutChange(id, next);
    }
    setDragDelta({ x: 0, y: 0 });
  }

  /** Start resizing a tile from the given edge or corner.
   *  Pointer deltas are in screen-space — normalize by zoom. */
  let abortResize: AbortController | null = null;
  function startResize(
    id: string,
    direction: ResizeDirection,
    e: PointerEvent,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const origin = layoutOf(id);
    if (!origin) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const limits = { minW: MIN_W, minH: MIN_H };

    abortResize?.abort();
    abortResize = new AbortController();
    capturePointerGesture(
      {
        onMove: (ev) => {
          const { dx, dy } = viewport.normalizeDelta(
            ev.clientX - startX,
            ev.clientY - startY,
          );
          setPendingLayout(id, applyResize(origin, direction, dx, dy, limits));
        },
        onEnd: (ev) => {
          abortResize = null;
          // No motion — skip commit so a bare click doesn't round-trip the server.
          if (!pendingLayouts.pending[id]) return;
          const { dx, dy } = viewport.normalizeDelta(
            ev.clientX - startX,
            ev.clientY - startY,
          );
          const snapped = applyResize(
            origin,
            direction,
            dx,
            dy,
            limits,
            viewport.snapToGrid,
          );
          setPendingLayout(id, snapped);
          props.onLayoutChange(id, snapped);
        },
      },
      abortResize,
    );
  }

  // No `defer: true`: the cascade effect bumps the signal during canvas
  // mount and on a remount (close-all → re-create) it can register
  // before this effect installs its tracker. Without defer the initial
  // run sees the bumped payload; a stale id from a prior mount resolves
  // to `layoutOf(id) === undefined` (the tile is gone) so the initial
  // run is a safe no-op.
  createEffect(
    on(focus.request, (id) => {
      if (!id) return;
      const layout = layoutOf(id);
      if (layout) {
        requestAnimationFrame(() => viewport.centerOnTile(layout));
      }
    }),
  );

  // On first mount at the default origin, pan so the persisted active tile
  // is centered (matches what a workspace-switcher click does). If there's no
  // active tile, fall back to centering the bounding box of all tiles so
  // restored sessions whose tiles live far from (0,0) don't open empty.
  const isDefaultViewport = () =>
    viewport.panX() === 0 && viewport.panY() === 0 && viewport.zoom() === 1;

  createEffect(() => {
    const ids = props.tileIds;
    if (ids.length === 0 || !isDefaultViewport()) return;
    // Wait for `session.get` to yield before deciding between "centre on
    // saved active" and "bbox fallback". `terminalList.get` (which feeds
    // `tileIds`) can win the race against `session.get` on cold load —
    // running the bbox fallback now would pan the viewport off-default,
    // and the `isDefaultViewport()` guard above would then block any
    // re-centre once `useSessionRestore` calls `setActiveSilently` with
    // the persisted id. Once `pending()` flips false, `useSessionRestore`'s
    // hydration effect runs synchronously (registered earlier) and assigns
    // the active id, so this effect re-runs and observes it.
    if (savedSessionSub.pending() && store.activeId() === null) return;
    const active = store.activeId();
    const activeLayout = active ? layoutOf(active) : undefined;
    if (activeLayout) {
      requestAnimationFrame(() => viewport.centerOnTile(activeLayout));
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of ids) {
      const l = layoutOf(id);
      if (!l) continue;
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.w);
      maxY = Math.max(maxY, l.y + l.h);
    }
    if (!Number.isFinite(minX)) return;
    requestAnimationFrame(() => {
      viewport.panTo((minX + maxX) / 2, (minY + maxY) / 2);
    });
  });

  return (
    <DragDropProvider onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <DragDropSensors />
      {/* Outer flex container — single mount point for the activity
       *  dock. The dock owns its own posture-conditional positioning:
       *  in maximized mode it's `relative shrink-0` (real left-panel
       *  flex sibling — the canvas takes the remaining width via
       *  `flex-1`); in tiled mode it's `absolute z-30 top-12 left-4`
       *  (floats over the canvas). The wrapper is `relative` so the
       *  dock's absolute coordinates in tiled mode resolve to the same
       *  `top: 5rem, left: 1rem` they did when mounted inside the
       *  canvas div.
       *  Mounting the dock once instead of toggling between two
       *  `<Show>` branches avoids tearing down its reactive scope on
       *  posture flips — the prior split-mount approach left the dock
       *  invisible until full page reload after enough toggles
       *  (#909 follow-up bug report). */}
      <div class="flex-1 min-h-0 overflow-hidden flex relative">
        <Dock
          onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
          onCreate={props.onCreate}
        />
        <div
          ref={(el) => viewport.setContainerRef(el, isWheelTargetTerminal)}
          data-testid="canvas-container"
          data-zoom={viewport.zoom()}
          data-viewport={viewport.canvasTransform()}
          class="flex-1 min-w-0 overflow-hidden relative canvas-grid-bg"
          style={{
            "background-position": viewport.gridBgPosition(),
            "background-size": viewport.gridBgSize(),
          }}
        >
          <Show when={props.watermark}>
            {(text) => <CanvasWatermark text={text()} />}
          </Show>
          {/* All tiles render in one stable list, every render. Pan/zoom
           *  composes into each tile's own `transform` (CanvasTile), so
           *  there's no wrapper transform — which means the active tile in
           *  maximized mode can use `absolute inset-0 z-40` to cover the
           *  canvas without a containing-block trap. Switching activeId in
           *  maximized mode reduces to a CSS class reshuffle on already-
           *  mounted tiles: no Terminal remount, no `document.fonts.load`,
           *  no stream re-attach, no scrollback replay (#988).
           *
           *  `data-viewport` on `canvas-container` carries the pan/zoom-only
           *  CSS string so tests can observe viewport state independently of
           *  per-tile transforms (which also fold in layout coords + drag). */}
          <For each={props.tileIds}>
            {(id) => {
              const active = () => store.activeId() === id;
              const mode = (): CanvasTileMode =>
                posture.mode() === "tiled"
                  ? "tiled"
                  : active()
                    ? "maximized"
                    : "covered";
              return (
                <Show when={store.getDisplayInfo(id)}>
                  {(info) => (
                    <CanvasTile
                      id={id}
                      active={active()}
                      mode={mode()}
                      dimmed={isStale(
                        store.getMetadata(id)?.lastActivityAt ?? 0,
                      )}
                      theme={tileTheme(id)}
                      repoColor={info().repoColor}
                      onSelect={() => props.onSelect(id)}
                      onClose={() => props.onClose(id)}
                      onToggleMaximize={posture.toggle}
                      renderTitle={() => props.renderTileTitle(id)}
                      renderTitleActions={
                        props.renderTileTitleActions
                          ? () => props.renderTileTitleActions?.(id)
                          : undefined
                      }
                      renderBody={() =>
                        props.renderTileBody(id, () => store.activeId() === id)
                      }
                      layouts={layouts()}
                      startResize={startResize}
                      panX={viewport.panX}
                      panY={viewport.panY}
                      zoom={viewport.zoom}
                    />
                  )}
                </Show>
              );
            }}
          </For>

          {/* Minimap: spatial dashboard; hides in fullscreen-single-tile mode
           *  since there's nothing spatial to summarize. */}
          <Show when={posture.mode() === "tiled"}>
            <CanvasMinimap
              tileIds={props.tileIds}
              layouts={layouts()}
              onSelect={props.onSelect}
              onAutoArrange={props.onAutoArrange}
              onStartTileDrag={(id) => {
                const origin = layoutOf(id);
                if (!origin) return null;
                return {
                  preview: (dx, dy) =>
                    setPendingLayout(id, {
                      ...origin,
                      x: origin.x + dx,
                      y: origin.y + dy,
                    }),
                  commit: (dx, dy) => {
                    const next: TileLayout = {
                      ...origin,
                      x: viewport.snapToGrid(origin.x + dx),
                      y: viewport.snapToGrid(origin.y + dy),
                    };
                    setPendingLayout(id, next);
                    props.onLayoutChange(id, next);
                  },
                };
              }}
            />
          </Show>
        </div>
      </div>
    </DragDropProvider>
  );
};

export default TerminalCanvas;
