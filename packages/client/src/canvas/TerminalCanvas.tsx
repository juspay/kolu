import { sleepingArm } from "@kolu/padi-client/surface";
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
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { savedSessionSub } from "../hostScope/activeWire";
import { useStaleCheck } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import type { TileId } from "../tile/tileContent";
import { useTileStore } from "../tile/useTileStore";
import { useShown } from "../ui/shown";
import CanvasMinimap from "./CanvasMinimap";
import CanvasTile, { type CanvasTileMode } from "./CanvasTile";
import Dock from "./dock/Dock";
import { applyResize, type ResizeDirection } from "./resizeGeometry";
import type { TileLayout } from "./TileLayout";
import {
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  findFreeTilePosition,
} from "./tilePlacement";
import { planTilePlacements } from "./tilePlacementPlan";
import { useCanvasCenterOnSwitch } from "./useCanvasCenterOnSwitch";
import { useCanvasFocus } from "./useCanvasFocus";
import { usePendingLayouts } from "./usePendingLayouts";
import { useTileAura } from "./useTileAura";
import { useTileTheme } from "./useTileTheme";
import { useViewPosture } from "./useViewPosture";
import { capturePointerGesture } from "./viewport/capturePointerGesture";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

const MIN_W = 300;
const MIN_H = 200;

function isWheelTargetTerminal(e: WheelEvent): boolean {
  return e.target instanceof Element && e.target.closest(".xterm") !== null;
}

const TerminalCanvas: Component<{
  tileIds: TileId[];
  getLayout: (id: TileId) => TileLayout | undefined;
  onAutoArrange?: () => void;
  onLayoutChange: (id: TileId, layout: TileLayout) => void;
  onSelect: (id: TileId) => void;
  onClose: (id: TileId) => void;
  onOpenWorkspaceSearch: () => void;
  onCreate: () => void;
  renderTileTitle: (id: TileId) => JSX.Element;
  renderTileTitleActions?: (id: TileId) => JSX.Element;
  renderTileBar?: (id: TileId) => JSX.Element;
  renderTileBody: (
    id: TileId,
    seen: () => boolean,
    boxDecided: () => boolean,
  ) => JSX.Element;
}> = (props) => {
  const canvasShown = useShown();
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const focus = useCanvasFocus();
  const tileTheme = useTileTheme();
  const posture = useViewPosture();
  const isStale = useStaleCheck();
  const tileAuraOf = useTileAura();

  const pendingLayouts = usePendingLayouts();
  const setPendingLayout = (id: string, layout: TileLayout) =>
    pendingLayouts.setOne(id, layout);

  createEffect(() => {
    pendingLayouts.dropEvicted(new Set(props.tileIds), props.getLayout);
  });

  onCleanup(() => pendingLayouts.clear());

  function layoutOf(id: string): TileLayout | undefined {
    return pendingLayouts.resolveLayout(id, props.getLayout(id));
  }

  const activeTileLayout = (): TileLayout | undefined => {
    const id = tileStore.activeId();
    return id ? layoutOf(id) : undefined;
  };
  useCanvasCenterOnSwitch(activeTileLayout);

  const isMetadataRecordPresent = (id: TileId): boolean =>
    store.getMetadata(id) !== undefined;
  const allRecordsSettled = createMemo(() =>
    props.tileIds.every(isMetadataRecordPresent),
  );
  createEffect(
    on(
      () => [props.tileIds, allRecordsSettled(), viewport.mounted()] as const,
      ([ids]) => {
        const center = viewport.viewportCenter();
        if (!center) return;
        const { x: cx, y: cy } = center;

        const plan = planTilePlacements(ids, layoutOf, (id) =>
          isMetadataRecordPresent(id),
        );

        const hasNewTiles = plan.some((p) => p.kind === "new");
        const inheritSize = hasNewTiles
          ? pendingLayouts.takeNextDefaultSize()
          : null;

        const placed: {
          id: TileId;
          layout: TileLayout;
          isNew: boolean;
        }[] = [];
        for (const p of plan) {
          if (p.kind === "defer") continue;
          if (p.kind === "existing") {
            placed.push({ id: p.id, layout: p.layout, isNew: false });
            continue;
          }
          const defaultLayout: TileLayout = {
            ...findFreeTilePosition(
              cx,
              cy,
              placed.map((x) => x.layout),
            ),
            w: inheritSize?.w ?? DEFAULT_TILE_W,
            h: inheritSize?.h ?? DEFAULT_TILE_H,
          };
          setPendingLayout(p.id, defaultLayout);
          props.onLayoutChange(p.id, defaultLayout);
          placed.push({ id: p.id, layout: defaultLayout, isNew: true });
        }
        const activeId = tileStore.activeId();
        if (activeId && placed.some((p) => p.isNew && p.id === activeId)) {
          tileStore.activateVisiblePane(activeId);
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
      setPendingLayout(id, next);
      props.onLayoutChange(id, next);
    }
    setDragDelta({ x: 0, y: 0 });
  }

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

  createEffect(
    on(focus.request, (id) => {
      if (!id) return;
      const layout = layoutOf(id);
      if (layout) {
        requestAnimationFrame(() => viewport.centerOnTile(layout));
      }
    }),
  );

  const isDefaultViewport = () =>
    viewport.panX() === 0 && viewport.panY() === 0 && viewport.zoom() === 1;

  createEffect(() => {
    const ids = props.tileIds;
    if (!viewport.mounted()) return;
    if (ids.length === 0 || !isDefaultViewport()) return;
    const savedActiveId = savedSessionSub()?.activeTerminalId ?? null;
    if (
      tileStore.activeId() === null &&
      (savedSessionSub.pending() || savedActiveId !== null)
    )
      return;
    const active = tileStore.activeId();
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

  function renderTerminalTile(
    tileId: TileId,
    terminalId: TerminalId,
  ): JSX.Element {
    const active = () => tileStore.isActiveTile(tileId);
    const mode = (): CanvasTileMode =>
      posture.layout() === "tiled"
        ? "tiled"
        : active()
          ? "maximized"
          : "covered";
    return (
      <Show when={store.getDisplayInfo(terminalId)}>
        {(info) => (
          <CanvasTile
            id={tileId}
            active={active()}
            mode={mode()}
            dimmed={isStale(store.getMetadata(terminalId)?.lastActivityAt ?? 0)}
            sleeping={sleepingArm(store.getMetadata(terminalId)) !== undefined}
            theme={tileTheme(terminalId)}
            repoColor={info().repoColor}
            onSelect={() => props.onSelect(tileId)}
            onClose={() => props.onClose(tileId)}
            onToggleMaximize={posture.toggle}
            renderTitle={() => props.renderTileTitle(tileId)}
            renderTitleActions={
              props.renderTileTitleActions
                ? () => props.renderTileTitleActions?.(tileId)
                : undefined
            }
            renderBar={() => props.renderTileBar?.(tileId)}
            renderBody={(facts) =>
              props.renderTileBody(tileId, facts.attached, facts.boxDecided)
            }
            getLayout={layoutOf}
            startResize={startResize}
            panX={viewport.panX}
            panY={viewport.panY}
            zoom={viewport.zoom}
            viewportSize={() =>
              viewport.mounted() ? viewport.viewportSize() : undefined
            }
            viewShown={canvasShown}
            cameraSettled={viewport.cameraSettled}
            auraTier={() => tileAuraOf(terminalId)}
          />
        )}
      </Show>
    );
  }

  return (
    <DragDropProvider onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <DragDropSensors />
      <div class="flex-1 min-h-0 overflow-hidden flex relative">
        <Dock
          onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
          onCreate={props.onCreate}
        />
        <div class="flex-1 min-w-0 min-h-0 flex flex-col">
          <div
            ref={(el) =>
              viewport.setContainerRef(el, {
                wheelTargetScrollsItself: isWheelTargetTerminal,
                covered: () => posture.layout() !== "tiled",
              })
            }
            data-testid="canvas-container"
            data-zoom={viewport.zoom()}
            data-viewport={viewport.canvasTransform()}
            class="flex-1 min-w-0 overflow-hidden relative canvas-grid-bg"
            style={{
              "background-position": viewport.gridBgPosition(),
              "background-size": viewport.gridBgSize(),
            }}
            onDblClick={(e) => {
              if (e.target === e.currentTarget) props.onCreate();
            }}
          >
            <For each={props.tileIds}>
              {(id) => {
                const content = () => tileStore.contentOf(id);
                return (
                  <Show when={content()}>
                    {(c) => (
                      <Switch>
                        <Match when={c().kind === "terminal" && c()}>
                          {(terminal) =>
                            renderTerminalTile(id, terminal().terminalId)
                          }
                        </Match>
                      </Switch>
                    )}
                  </Show>
                );
              }}
            </For>

            <Show when={viewport.mounted()}>
              <div
                classList={{ hidden: posture.layout() !== "tiled" }}
                inert={posture.layout() !== "tiled"}
              >
                <CanvasMinimap
                  shown={posture.layout() === "tiled"}
                  tileIds={props.tileIds}
                  getLayout={layoutOf}
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
              </div>
            </Show>
          </div>
        </div>
      </div>
    </DragDropProvider>
  );
};

export default TerminalCanvas;
