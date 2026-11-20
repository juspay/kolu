import type { Component } from "solid-js";
import { useViewPosture } from "../canvas/useViewPosture";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";

const SHELL = "h-7 shrink-0 rounded-lg border border-edge";

const segmentClass =
  "flex items-center gap-1.5 px-2 py-1 font-mono text-[0.65rem] font-semibold cursor-pointer transition-colors";

const ModeControl: Component = () => {
  const view = useViewPosture();

  const mode = (): "canvas" | "maximized" =>
    view.layout() === "maximized" ? "maximized" : "canvas";

  return (
    <div
      data-testid="mode-control"
      class={`${SHELL} flex items-stretch overflow-hidden`}
    >
      <Tip label="Canvas">
        <button
          type="button"
          data-testid="mode-canvas"
          data-active={mode() === "canvas" ? "" : undefined}
          class={segmentClass}
          classList={{
            "text-accent bg-accent/12": mode() === "canvas",
            "text-fg-3 hover:text-fg": mode() !== "canvas",
          }}
          onClick={() => view.postureTo(false)}
        >
          ▦ canvas
        </button>
      </Tip>
      <Tip
        label={`Maximize terminal (${formatKeybind(ACTIONS.toggleCanvasPosture.keybind)})`}
      >
        <button
          type="button"
          data-testid="mode-maximized"
          data-active={mode() === "maximized" ? "" : undefined}
          class={`${segmentClass} border-l border-edge`}
          classList={{
            "text-accent bg-accent/12": mode() === "maximized",
            "text-fg-3 hover:text-fg":
              mode() !== "maximized" && view.canMaximize(),
            "text-fg-3/40 cursor-not-allowed": !view.canMaximize(),
          }}
          disabled={!view.canMaximize()}
          onClick={() => view.postureTo(true)}
        >
          ▢ maximized
        </button>
      </Tip>
    </div>
  );
};

export default ModeControl;
