import { sleepingArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";
import { MOONLIT } from "../terminal/moonlit";
import { formatTimeAgo, useStaleCheck } from "../terminal/staleness";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";
import { ActivityWindowChip } from "../ui/ActivityWindowChip";
import { GridIcon } from "../ui/Icons";
import { bucketDescriptor, metaBucket } from "./dockModel";
import {
  handleMinimapClick,
  startTileDrag,
  startViewportDrag,
} from "./minimapGestures";
import type { TileLayout } from "./TileLayout";
import { useTileTheme } from "./useTileTheme";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

const MAP_W = 180;
const MAP_H = 120;
const MAP_PAD = 100;
const GHOST_PX = 6;
const MORPH_TRANSITION = "duration-300 ease-out";
const TILE_TRANSITION_PROPS =
  "transition-[left,top,width,height,background-color,border-color,border-radius]";

function tileTooltip(
  info: TerminalDisplayInfo,
  meta: TerminalMetadata,
  presence: "sleeping" | "parked" | "agent" | "none",
): string {
  const { group, label, suffix } = info.key;
  const headParts: string[] = [group];
  if (label && label !== group) headParts.push(label);
  if (suffix) headParts.push(suffix);
  const head = headParts.join(" · ");
  const lines = [head];
  const sleeping = sleepingArm(meta);
  if (sleeping) {
    const ago = formatTimeAgo(sleeping.sleptAt);
    lines.push(ago ? `Asleep — ${ago}` : "Asleep");
  } else {
    const ago = formatTimeAgo(meta.lastActivityAt);
    if (ago)
      lines.push(
        presence === "parked" ? `Parked — last active ${ago}` : `Active ${ago}`,
      );
  }
  return lines.join("\n");
}

const ZoomBarButton: Component<{
  testId: string;
  title: string;
  icon: JSX.Element;
  onClick: () => void;
}> = (props) => (
  <button
    type="button"
    data-testid={props.testId}
    class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer border-l border-edge/40"
    title={props.title}
    onClick={props.onClick}
  >
    {props.icon}
  </button>
);

const CanvasMinimap: Component<{
  shown: boolean;
  tileIds: string[];
  getLayout: (id: string) => TileLayout | undefined;
  onSelect: (id: string) => void;
  onStartTileDrag: (id: string) => {
    preview: (dx: number, dy: number) => void;
    commit: (dx: number, dy: number) => void;
  } | null;
  onAutoArrange?: () => void;
}> = (props) => {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const tileTheme = useTileTheme();
  const [hoveringViewport, setHoveringViewport] = createSignal(false);
  const [draggingViewport, setDraggingViewport] = createSignal(false);
  const isParked = useStaleCheck();

  const bounds = createMemo(
    (previous: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      w: number;
      h: number;
    }) => {
      if (!props.shown) return previous;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const id of props.tileIds) {
        const l = props.getLayout(id);
        if (!l) continue;
        minX = Math.min(minX, l.x);
        minY = Math.min(minY, l.y);
        maxX = Math.max(maxX, l.x + l.w);
        maxY = Math.max(maxY, l.y + l.h);
      }
      if (!Number.isFinite(minX))
        return { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 };
      const padMinX = minX - MAP_PAD;
      const padMinY = minY - MAP_PAD;
      const padMaxX = maxX + MAP_PAD;
      const padMaxY = maxY + MAP_PAD;
      return {
        minX: padMinX,
        minY: padMinY,
        maxX: padMaxX,
        maxY: padMaxY,
        w: padMaxX - padMinX,
        h: padMaxY - padMinY,
      };
    },
    { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 },
  );

  const minimapScale = createMemo(() => {
    const b = bounds();
    return Math.min(MAP_W / b.w, MAP_H / b.h);
  });

  const toMinimap = (cx: number, cy: number, scale: number) => {
    const b = bounds();
    return {
      x: (cx - b.minX) * scale,
      y: (cy - b.minY) * scale,
    };
  };

  const viewportRect = createMemo(() => {
    const s = minimapScale();
    const z = viewport.zoom();
    const vs = viewport.viewportSize();
    const vw = vs.width / z;
    const vh = vs.height / z;
    const pos = toMinimap(viewport.panX(), viewport.panY(), s);
    return { x: pos.x, y: pos.y, w: vw * s, h: vh * s };
  });

  const mapContent = createMemo(() => {
    const b = bounds();
    const s = minimapScale();
    return { contentWidthPx: b.w * s, contentHeightPx: b.h * s };
  });

  let abortDrag: AbortController | null = null;
  let abortTileDrag: AbortController | null = null;
  let suppressNextClick = false;
  function handleViewportDrag(e: PointerEvent) {
    abortDrag = startViewportDrag(
      e,
      viewport,
      minimapScale(),
      abortDrag,
      (dragging) => {
        setDraggingViewport(dragging);
        if (!dragging) suppressNextClick = true;
      },
    );
  }

  function handleMapPointerDown(e: PointerEvent) {
    const map = e.currentTarget as HTMLDivElement;
    const rect = map.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const view = viewportRect();
    const insideViewport =
      localX >= view.x &&
      localX <= view.x + view.w &&
      localY >= view.y &&
      localY <= view.y + view.h;
    if (!insideViewport) return;
    handleViewportDrag(e);
  }

  function handleMapPointerMove(e: PointerEvent) {
    const map = e.currentTarget as HTMLDivElement;
    const rect = map.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const view = viewportRect();
    setHoveringViewport(
      e.target === map &&
        localX >= view.x &&
        localX <= view.x + view.w &&
        localY >= view.y &&
        localY <= view.y + view.h,
    );
  }

  function handleMapClick(e: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    if (e.clientX - rect.left > mapContent().contentWidthPx) return;
    handleMinimapClick(e, viewport, minimapScale(), bounds());
  }

  return (
    <div
      data-testid="canvas-minimap"
      class="absolute bottom-4 left-4 z-20 flex flex-col items-stretch gap-px"
    >
      <div
        data-testid="minimap-map"
        class="rounded-t-lg bg-surface-2/80 backdrop-blur-sm border border-b-0 border-edge/40 overflow-hidden"
        style={{
          "min-width": `${mapContent().contentWidthPx}px`,
          height: `${mapContent().contentHeightPx}px`,
        }}
        classList={{
          "cursor-default": !hoveringViewport() && !draggingViewport(),
          "cursor-grab": hoveringViewport() && !draggingViewport(),
          "cursor-grabbing": draggingViewport(),
        }}
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerLeave={() => setHoveringViewport(false)}
        onClick={handleMapClick}
      >
        <For each={props.tileIds}>
          {(id) => {
            const layout = () => props.getLayout(id);
            const theme = () => tileTheme(id);
            const info = createMemo(() => store.getDisplayInfo(id));
            const meta = createMemo(() => store.getMetadata(id));
            const tile = createMemo(() => {
              const l = layout();
              const i = info();
              if (!l || !i || !meta()) return null;
              const s = minimapScale();
              const p = toMinimap(l.x, l.y, s);
              return {
                x: p.x,
                y: p.y,
                w: l.w * s,
                h: l.h * s,
                repoColor: i.repoColor,
              };
            });
            const state = createMemo(() => {
              const mt = meta();
              if (!mt)
                return { presence: "none" as const, bucket: "none" as const };
              const bucket = metaBucket(mt);
              const presence = sleepingArm(mt)
                ? ("sleeping" as const)
                : isParked(mt.lastActivityAt)
                  ? ("parked" as const)
                  : bucket !== "none"
                    ? ("agent" as const)
                    : ("none" as const);
              return { presence, bucket };
            });
            const tooltip = () => {
              const i = info();
              const mt = meta();
              return i && mt ? tileTooltip(i, mt, state().presence) : id;
            };
            const handleTileClick = (e: MouseEvent) => {
              e.stopPropagation();
              if (suppressNextClick) {
                suppressNextClick = false;
                return;
              }
              const l = layout();
              if (!l) return;
              props.onSelect(id);
              viewport.centerOnTile(l);
            };
            const handleTilePointerDown = (e: PointerEvent) => {
              e.stopPropagation();
              const drag = props.onStartTileDrag(id);
              if (!drag) return;
              abortTileDrag = startTileDrag(e, minimapScale(), abortTileDrag, {
                onDragStart: () => props.onSelect(id),
                onPreview: drag.preview,
                onCommit: (dx, dy) => {
                  drag.commit(dx, dy);
                  suppressNextClick = true;
                },
              });
            };
            const presence = () => state().presence;
            const parked = () => presence() === "parked";
            const sleeping = () => presence() === "sleeping";
            const isActive = () => tileStore.isActiveTile(id);
            const hasAgent = () => presence() === "agent";
            const badgeVisible = () => hasAgent();
            const tileStyle = (t: {
              x: number;
              y: number;
              w: number;
              h: number;
              repoColor: string;
            }): JSX.CSSProperties => {
              if (sleeping()) {
                return {
                  left: `${t.x}px`,
                  top: `${t.y}px`,
                  width: `${t.w}px`,
                  height: `${t.h}px`,
                  "background-color": MOONLIT.tileBg,
                  border: `1px dashed ${MOONLIT.accent}`,
                };
              }
              if (parked()) {
                return {
                  left: `${t.x + t.w / 2 - GHOST_PX / 2}px`,
                  top: `${t.y + t.h / 2 - GHOST_PX / 2}px`,
                  width: `${GHOST_PX}px`,
                  height: `${GHOST_PX}px`,
                  border: "1px solid transparent",
                };
              }
              return {
                left: `${t.x}px`,
                top: `${t.y}px`,
                width: `${t.w}px`,
                height: `${t.h}px`,
                "background-color": `color-mix(in oklab, ${t.repoColor} 32%, ${theme().bg})`,
                border: `1.5px solid ${t.repoColor}`,
              };
            };
            return (
              <Show when={tile()}>
                {(t) => (
                  <div
                    data-testid="minimap-tile-rect"
                    data-tile-id={id}
                    data-bucket={state().bucket}
                    data-parked={parked() ? "" : undefined}
                    class={`absolute cursor-pointer ${TILE_TRANSITION_PROPS} ${MORPH_TRANSITION} hover:ring-1 hover:ring-accent/40`}
                    classList={{
                      "rounded-full bg-fg-3/40": parked(),
                      "rounded-sm hover:opacity-100": !parked(),
                      "ring-1 ring-accent/60": isActive(),
                      "opacity-100": isActive() || parked(),
                      "opacity-70": !isActive() && !parked(),
                    }}
                    style={tileStyle(t())}
                    title={tooltip()}
                    onPointerDown={handleTilePointerDown}
                    onClick={handleTileClick}
                  >
                    <Show when={hasAgent() || parked()}>
                      <span
                        data-testid={`minimap-${state().bucket}-dot`}
                        class={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none transition-opacity ${MORPH_TRANSITION}`}
                        classList={{
                          "opacity-0": !badgeVisible(),
                          "opacity-100": badgeVisible(),
                        }}
                        style={{
                          "background-color": bucketDescriptor(state().bucket)
                            .accentVar,
                        }}
                      />
                    </Show>
                  </div>
                )}
              </Show>
            );
          }}
        </For>

        <div
          data-testid="minimap-viewport-rect"
          class="absolute pointer-events-none border-2 border-accent/50 rounded-sm"
          style={{
            left: `${viewportRect().x}px`,
            top: `${viewportRect().y}px`,
            width: `${viewportRect().w}px`,
            height: `${viewportRect().h}px`,
            "background-color":
              "var(--color-accent-alpha, rgba(99, 102, 241, 0.08))",
          }}
        />
      </div>

      <div
        data-testid="minimap-zoombar"
        class="flex items-center gap-px bg-surface-2/80 backdrop-blur-sm border border-t-0 border-edge/40 overflow-hidden rounded-b-lg"
      >
        <button
          type="button"
          class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
          title="Zoom out"
          onClick={() => viewport.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          class="flex items-center justify-center min-w-[3rem] h-8 px-1 text-fg-2 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-xs tabular-nums"
          title="Reset to 100%"
          onClick={() => viewport.resetZoom()}
        >
          {Math.round(viewport.zoom() * 100)}%
        </button>
        <button
          type="button"
          class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
          title="Zoom in"
          onClick={() => viewport.zoomIn()}
        >
          +
        </button>
        <Show when={props.onAutoArrange && props.tileIds.length > 1}>
          <ZoomBarButton
            testId="minimap-arrange"
            title="Arrange canvas by repo"
            icon={<GridIcon class="w-3.5 h-3.5" />}
            onClick={() => props.onAutoArrange?.()}
          />
        </Show>
        <ActivityWindowChip
          anchor="top-end"
          testIdPrefix="minimap-window"
          class="min-w-[2.5rem] h-8 px-1 border-l border-edge/40 text-xs hover:bg-surface-3/60"
        />
      </div>
    </div>
  );
};

export default CanvasMinimap;
