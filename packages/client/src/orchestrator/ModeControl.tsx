/** The two POSTURES of a host's canvas, as one control.
 *
 *  `canvas` and `maximized` are mutually exclusive views OF A HOST TAB, which
 *  is the whole of what this control is for. The orchestrator is not a third
 *  segment here: it is its own entry in the chrome bar beside the host tabs
 *  (`OrchestratorTab`), because it is a different destination rather than a
 *  different way of looking at the same one. Pressing either segment while the
 *  orchestrator is on screen therefore LEAVES it — the press is a choice about
 *  the host tab underneath, and `postureTo` is the one writer that knows it. */

import type { Component } from "solid-js";
import { useViewPosture } from "../canvas/useViewPosture";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";

const segmentClass =
  "flex items-center gap-1.5 px-2 py-1 font-mono text-[0.65rem] font-semibold cursor-pointer transition-colors";

const ModeControl: Component = () => {
  const view = useViewPosture();

  /** Which segment is lit. The orchestrator borrows nothing from the posture
   *  any more — it is a destination beside the host tabs — so the layout the
   *  canvas is in IS the choice this control reports. */
  const mode = (): "canvas" | "maximized" =>
    view.layout() === "maximized" ? "maximized" : "canvas";

  return (
    <div
      data-testid="mode-control"
      class="flex items-stretch rounded-lg border border-edge overflow-hidden"
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
          {/* GLYPH AND WORD, both. Three unlabelled marks in a row is a rebus:
              nothing in `▦ ▢ ◆` says which is the conversation, and the one
              that matters most here is the one a person has never seen before.
              The word is what makes the control readable on first sight. */}
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
