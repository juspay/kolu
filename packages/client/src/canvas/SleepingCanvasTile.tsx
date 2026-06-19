/** A sleeping terminal rendered on the canvas — a real, draggable + resizable
 *  tile that just happens to be dormant (no PTY, no WebGL, no xterm). It uses
 *  the same `createDraggable` + pan/zoom transform + resize handles as a live
 *  `CanvasTile`, and persists its moved/resized layout back into the record, so
 *  it behaves exactly like a live tile — you can shove it aside, line it up, or
 *  resize it while its work is parked. The header is the drag handle; the body
 *  carries a Wake button; the × discards the record.
 *
 *  Distinct from `CanvasTile` (the live-tile shell): a sleeping record carries
 *  no live metadata or theme, so it can't flow through the live tile path — it
 *  gets this lightweight, self-sufficient render with its own moonlit chrome. */

import { createDraggable } from "@thisbeyond/solid-dnd";
import type { SleepingTerminal } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { Z_CANVAS_TILE_INACTIVE } from "../ui/stackLayers";
import { RESIZE_HANDLES, type ResizeDirection } from "./resizeGeometry";
import type { TileLayout } from "./TileLayout";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import { tileTransformCSS } from "./viewport/coordinates";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

const SleepingCanvasTile: Component<{
  record: SleepingTerminal;
  /** Current layout (canvas-space), incl. any in-flight pending drag/resize. */
  layout: () => TileLayout | undefined;
  panX: () => number;
  panY: () => number;
  zoom: () => number;
  startResize: (id: string, dir: ResizeDirection, e: PointerEvent) => void;
  onWake: () => void;
  onDiscard: () => void;
}> = (props) => {
  const id = props.record.id;
  const draggable = createDraggable(id);
  const top = () =>
    props.record.terminals.find((t) => !t.parentId) ??
    props.record.terminals[0];
  const layout = (): TileLayout =>
    props.layout() ?? { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
  const intent = () => top()?.intent?.trim();
  const cwd = () => top()?.cwd ?? "";

  return (
    <div
      ref={draggable.ref}
      data-testid="sleeping-canvas-tile"
      data-sleeping-tile=""
      data-terminal-id={id}
      class="absolute flex flex-col overflow-hidden rounded-xl"
      style={{
        left: `${layout().x}px`,
        top: `${layout().y}px`,
        width: `${layout().w}px`,
        height: `${layout().h}px`,
        "z-index": Z_CANVAS_TILE_INACTIVE,
        "transform-origin": "0 0",
        transform: tileTransformCSS(
          layout().x,
          layout().y,
          props.panX(),
          props.panY(),
          props.zoom(),
          draggable.transform.x,
          draggable.transform.y,
        ),
        background: "#20242d",
        border: "1.5px dashed #8895ad99",
        "box-shadow": "0 4px 16px rgba(0,0,0,0.32)",
        opacity: "0.97",
      }}
    >
      {/* Header — the drag handle (solid-dnd activators), ☾ marker, discard ×. */}
      <div
        class="flex items-center gap-1.5 px-2.5 py-1.5 shrink-0 select-none cursor-grab active:cursor-grabbing"
        style={{ "border-bottom": "1px solid #2a2e37", background: "#1a1e26" }}
        {...draggable.dragActivators}
      >
        <span style={{ color: "#8895ad" }} aria-hidden="true">
          ☾
        </span>
        <span class="text-xs font-semibold" style={{ color: "#8895ad" }}>
          asleep
        </span>
        <button
          type="button"
          data-testid="sleeping-tile-discard"
          class="ml-auto text-sm pointer-events-auto leading-none"
          style={{ color: "#5b626d" }}
          title="Discard — delete without waking"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.onDiscard();
          }}
        >
          ×
        </button>
      </div>

      {/* Dormant body — intent, cwd, and a Wake button. */}
      <div class="flex-1 min-h-0 px-2.5 py-2 flex flex-col gap-1 overflow-hidden">
        <Show
          when={intent()}
          fallback={
            <span class="text-xs font-semibold" style={{ color: "#c7ccd6" }}>
              {basename(cwd())}
            </span>
          }
        >
          <span
            class="text-xs font-semibold leading-snug"
            style={{ color: "#c7ccd6" }}
          >
            {intent()}
          </span>
        </Show>
        <span
          class="text-[0.66rem] font-mono truncate"
          style={{ color: "#8b929d" }}
        >
          📁 {basename(cwd())}
        </span>
        <span class="text-[0.6rem]" style={{ color: "#5b626d" }}>
          PTY released
        </span>
        <button
          type="button"
          data-testid="sleeping-tile-wake"
          class="mt-auto self-start text-[0.7rem] font-semibold rounded px-2.5 py-1 pointer-events-auto"
          style={{ background: "#8895ad", color: "#0e1014" }}
          onClick={props.onWake}
        >
          Wake
        </button>
      </div>

      {/* Resize handles — 4 edges + 4 corners, same set as a live tile. */}
      <For each={Object.entries(RESIZE_HANDLES)}>
        {([direction, handle]) => (
          <div
            class={`absolute ${handle.position} ${handle.cursor}`}
            onPointerDown={(e) =>
              props.startResize(id, direction as ResizeDirection, e)
            }
          />
        )}
      </For>
    </div>
  );
};

export default SleepingCanvasTile;
