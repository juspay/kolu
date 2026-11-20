import { createDraggable } from "@thisbeyond/solid-dnd";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onMount,
  Show,
} from "solid-js";
import { match } from "ts-pattern";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { MaximizeIcon, RestoreIcon } from "../ui/Icons";
import {
  Z_CANVAS_TILE_ACTIVE,
  Z_CANVAS_TILE_INACTIVE,
} from "../ui/stackLayers";
import { RESIZE_HANDLES, type ResizeDirection } from "./resizeGeometry";
import type { TileLayout } from "./TileLayout";
import type { TileAura } from "./tileAura";
import {
  type TileTheme,
  tileChromeButton,
  tileFgTier,
  tileTitleBarBg,
  tileTitleBarBorder,
} from "./tileChrome";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import { createHeldSeen, tileIsSeen } from "./tileSeen";
import { prefersReducedMotion } from "./viewport/animatedPan";
import { tileTransformCSS } from "./viewport/coordinates";

export type { TileTheme };

export type CanvasTileMode = "tiled" | "maximized" | "covered";

export type TileBodyFacts = {
  attached: () => boolean;
  boxDecided: () => boolean;
};

const CanvasTile: Component<{
  id: string;
  active: boolean;
  mode: CanvasTileMode;
  dimmed?: boolean;
  sleeping?: boolean;
  theme: TileTheme;
  repoColor: string;
  onSelect: () => void;
  onClose: () => void;
  onToggleMaximize: () => void;
  renderTitle: () => JSX.Element;
  renderTitleActions?: () => JSX.Element;
  renderBar?: () => JSX.Element;
  renderBody: (facts: TileBodyFacts) => JSX.Element;
  getLayout: (id: string) => TileLayout | undefined;
  startResize: (
    id: string,
    direction: ResizeDirection,
    e: PointerEvent,
  ) => void;
  panX: () => number;
  panY: () => number;
  zoom: () => number;
  cameraSettled: () => boolean;
  viewportSize: () => { width: number; height: number } | undefined;
  viewShown: () => boolean;
  auraTier?: () => TileAura;
}> = (props) => {
  const isMaximized = () => props.mode === "maximized";
  const isCovered = () => props.mode === "covered";
  const draggable = createDraggable(props.id);
  const placed = () => props.getLayout(props.id);
  const layout = () =>
    placed() ?? {
      x: 0,
      y: 0,
      w: DEFAULT_TILE_W,
      h: DEFAULT_TILE_H,
    };

  const [landing, setLanding] = createSignal(false);
  const spendLanding = () => setLanding(false);
  onMount(() => {
    if (prefersReducedMotion() || props.sleeping || props.mode !== "tiled")
      return;
    setLanding(true);
  });
  createEffect(() => {
    if (!landing()) return;
    if (props.sleeping || props.mode !== "tiled" || prefersReducedMotion()) {
      spendLanding();
    }
  });
  const onLandInAnim: JSX.EventHandlerUnion<HTMLDivElement, AnimationEvent> = (
    e,
  ) => {
    if (e.target === e.currentTarget && e.animationName === "tile-place-in") {
      spendLanding();
    }
  };

  const bg = () => props.theme.bg;
  const aura = createMemo((): TileAura => props.auraTier?.() ?? "none");
  const onScreen = createMemo(() => {
    const size = props.viewportSize();
    if (!size) return false;
    const l = placed();
    if (!l) return false;
    const { width, height } = size;
    const z = props.zoom();
    const sx = (l.x - props.panX()) * z;
    const sy = (l.y - props.panY()) * z;
    const m = 200;
    return (
      sx + l.w * z > -m &&
      sx < width + m &&
      sy + l.h * z > -m &&
      sy < height + m
    );
  });
  const seen = createMemo(() =>
    tileIsSeen({
      viewShown: props.viewShown(),
      cameraSettled: props.cameraSettled(),
      mode: props.mode,
      active: props.active,
      onScreen: onScreen(),
    }),
  );
  const heldSeen = createHeldSeen(seen);
  const bodyFacts: TileBodyFacts = {
    attached: heldSeen,
    boxDecided: () => !isCovered(),
  };

  const showAura = createMemo(
    () => aura() !== "none" && props.mode === "tiled" && onScreen(),
  );

  const [exhale, setExhale] = createSignal(false);
  let prevAura: TileAura = "none";
  createEffect(() => {
    const next = aura();
    const enteredFinished = next === "finished" && prevAura !== "finished";
    const eligible =
      showAura() && props.active !== true && !prefersReducedMotion();
    if (enteredFinished) {
      setExhale(eligible);
    } else if (next !== "finished" || !eligible) {
      setExhale(false);
    }
    prevAura = next;
  });
  const onAuraAnim: JSX.EventHandlerUnion<HTMLDivElement, AnimationEvent> = (
    e,
  ) => {
    if (e.animationName === "tile-aura-exhale") setExhale(false);
  };

  const inactiveOpacity = () => (props.dimmed ? 0.55 : 0.92);

  const tiledStyle = (): JSX.CSSProperties => {
    const l = layout();
    return {
      position: "absolute",
      left: `${l.x}px`,
      top: `${l.y}px`,
      width: `${l.w}px`,
      height: `${l.h}px`,
      "background-color": bg(),
      "border-color": props.repoColor,
      "--aura-c": props.repoColor,
      "z-index": props.active ? Z_CANVAS_TILE_ACTIVE : Z_CANVAS_TILE_INACTIVE,
      opacity: props.active ? 1 : inactiveOpacity(),
      "box-shadow": props.active
        ? `0 8px 32px rgba(0,0,0,0.4)`
        : `0 2px 8px rgba(0,0,0,0.2)`,
      outline: props.active
        ? `var(--tile-moat-stroke) solid ${props.repoColor}`
        : undefined,
      "outline-offset": props.active ? "var(--tile-moat-offset)" : undefined,
      "transform-origin": "0 0",
      transform: tileTransformCSS(
        l.x,
        l.y,
        props.panX(),
        props.panY(),
        props.zoom(),
        draggable.transform.x,
        draggable.transform.y,
      ),
    };
  };

  const presentation = createMemo(
    (): {
      style: JSX.CSSProperties;
      classes: Record<string, boolean>;
      inert: boolean;
    } => {
      const fullViewportBox: JSX.CSSProperties = {
        position: "absolute",
        inset: 0,
        "background-color": bg(),
      };
      return match(props.mode)
        .with("maximized", () => ({
          style: { ...fullViewportBox, "z-index": 40 },
          classes: { "border-transparent": true },
          inert: false,
        }))
        .with("covered", () => ({
          style: { ...tiledStyle(), visibility: "hidden" as const },
          classes: { "border-transparent": true },
          inert: true,
        }))
        .with("tiled", () => ({
          style: tiledStyle(),
          classes: { "rounded-xl": true },
          inert: false,
        }))
        .exhaustive();
    },
  );

  return (
    <div
      ref={(el) => {
        draggable.ref(el);
      }}
      data-testid="canvas-tile"
      data-canvas-tile=""
      data-terminal-id={props.id}
      data-active={props.active ? "" : undefined}
      data-maximized={isMaximized() ? "true" : undefined}
      data-dimmed={props.dimmed ? "true" : undefined}
      data-sleeping={props.sleeping ? "" : undefined}
      data-landing={
        landing() && props.mode === "tiled" && !props.sleeping ? "" : undefined
      }
      data-exhale={
        exhale() && showAura() && aura() === "finished" ? "" : undefined
      }
      data-aura={showAura() ? aura() : undefined}
      inert={presentation().inert}
      class="relative border transition-shadow duration-200 overflow-visible"
      classList={presentation().classes}
      style={presentation().style}
      onMouseDown={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("[data-visible][data-terminal-id]")
        )
          return;
        props.onSelect();
      }}
      onAnimationEnd={onLandInAnim}
      onAnimationCancel={onLandInAnim}
    >
      <div class="absolute inset-0 flex flex-col overflow-hidden rounded-[inherit]">
        <div
          data-testid="canvas-tile-titlebar"
          class="grid [grid-template-columns:minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1.5 shrink-0 select-none border-l-4"
          classList={{
            "cursor-grab active:cursor-grabbing": !isMaximized(),
          }}
          style={{
            "background-color": tileTitleBarBg(props.theme),
            "border-bottom": `1px solid ${tileTitleBarBorder(props.theme)}`,
            "border-left-color": props.repoColor,
            "--color-fg": tileFgTier(props.theme, 1),
            "--color-fg-2": tileFgTier(props.theme, 2),
            "--color-fg-3": tileFgTier(props.theme, 3),
          }}
          onMouseDown={(e) => e.preventDefault()}
          onDblClick={(e) => {
            e.stopPropagation();
            props.onToggleMaximize();
          }}
          {...(props.mode === "tiled" ? draggable.dragActivators : {})}
        >
          <div class="contents">{props.renderTitle()}</div>
          <div class="col-start-2 row-start-1 flex items-center gap-1 shrink-0">
            {props.renderTitleActions?.()}
            <button
              type="button"
              data-testid="canvas-tile-maximize"
              class={`${CHROME_ICON_BUTTON_CLASS} pointer-events-auto hover:bg-black/20`}
              style={{
                color: tileChromeButton(props.theme),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleMaximize();
              }}
              title={isMaximized() ? "Restore to canvas" : "Maximize"}
            >
              <Show when={isMaximized()} fallback={<MaximizeIcon />}>
                <RestoreIcon />
              </Show>
            </button>
            <button
              type="button"
              data-testid="canvas-tile-close"
              class={`${CHROME_ICON_BUTTON_CLASS} pointer-events-auto text-sm`}
              style={{
                color: tileChromeButton(props.theme),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                props.onClose();
              }}
              title="Close terminal"
            >
              ×
            </button>
          </div>
        </div>

        {props.renderBar?.()}

        {props.renderBody(bodyFacts)}
      </div>

      <Show when={props.mode === "tiled"}>
        <For each={Object.entries(RESIZE_HANDLES)}>
          {([direction, handle]) => (
            <div
              class={`absolute ${handle.position} ${handle.cursor}`}
              onPointerDown={(e) =>
                props.startResize(props.id, direction as ResizeDirection, e)
              }
            />
          )}
        </For>
      </Show>

      <Show when={showAura()}>
        <div
          class="tile-aura tile-aura-ring"
          aria-hidden="true"
          onAnimationEnd={onAuraAnim}
          onAnimationCancel={onAuraAnim}
        />
      </Show>
    </div>
  );
};

export default CanvasTile;
