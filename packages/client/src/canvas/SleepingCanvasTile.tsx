/** A sleeping terminal rendered on the canvas — a folded, dormant placeholder
 *  that holds its saved slot but shrinks to fit its content (no PTY, no WebGL,
 *  no xterm). Positioned with the same pan/zoom transform as a live tile, so it
 *  sits where the terminal used to be. The whole card is the wake target.
 *
 *  Distinct from `CanvasTile` (the live-tile shell): a sleeping record carries
 *  no live metadata, only a `SavedTerminal`, so it can't flow through the live
 *  tile path — it gets this lightweight, self-sufficient render instead. */

import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { SleepingTerminal } from "kolu-common/surface";
import { Z_CANVAS_TILE_INACTIVE } from "../ui/stackLayers";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import { tileTransformCSS } from "./viewport/coordinates";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

const SleepingCanvasTile: Component<{
  record: SleepingTerminal;
  panX: () => number;
  panY: () => number;
  zoom: () => number;
  onWake: () => void;
}> = (props) => {
  const top = () =>
    props.record.terminals.find((t) => !t.parentId) ??
    props.record.terminals[0];
  const layout = () =>
    top()?.canvasLayout ?? { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };
  const intent = () => top()?.intent?.trim();
  const cwd = () => top()?.cwd ?? "";

  return (
    <button
      type="button"
      data-testid="sleeping-canvas-tile"
      data-sleeping-tile=""
      class="absolute flex flex-col text-left rounded-xl overflow-hidden"
      title="Wake terminal — resume in place"
      onClick={props.onWake}
      style={{
        // Hold the saved position; size to content (compact), not the old
        // footprint — the point is a small marker, not a full-size ghost.
        left: `${layout().x}px`,
        top: `${layout().y}px`,
        width: "15rem",
        "z-index": Z_CANVAS_TILE_INACTIVE,
        "transform-origin": "0 0",
        transform: tileTransformCSS(
          layout().x,
          layout().y,
          props.panX(),
          props.panY(),
          props.zoom(),
          0,
          0,
        ),
        background: "#20242d",
        border: "1.5px dashed #8895ad99",
        "box-shadow": "0 4px 16px rgba(0,0,0,0.32)",
        opacity: "0.97",
      }}
    >
      <div
        class="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{
          "border-bottom": "1px solid #2a2e37",
          background: "#1a1e26",
        }}
      >
        <span style={{ color: "#8895ad" }} aria-hidden="true">
          ☾
        </span>
        <span class="text-xs font-semibold" style={{ color: "#8895ad" }}>
          asleep
        </span>
        <span
          class="ml-auto text-[0.62rem] font-semibold rounded px-1.5 py-0.5"
          style={{ background: "#8895ad", color: "#0e1014" }}
        >
          Wake
        </span>
      </div>
      <div class="px-2.5 py-2 flex flex-col gap-1">
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
          PTY released · click to resume
        </span>
      </div>
    </button>
  );
};

export default SleepingCanvasTile;
