/** The two POSTURES of a host's canvas, as one control.
 *
 *  `canvas` and `maximized` are mutually exclusive views OF A HOST TAB, which
 *  is the whole of what this control is for. The conductor is not a third
 *  segment here: it is a place of its own, the first tab in the chrome bar's
 *  tab row (`ConductorTab`), and while it is the current place this control is
 *  not drawn at all (`ChromeBar`) — there is no host canvas on screen for it
 *  to describe. */

import type { Component } from "solid-js";
import { useViewPosture } from "../canvas/useViewPosture";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";

/** The box the two segments share: the chrome's control height, radius and
 *  edge. */
const SHELL = "h-7 shrink-0 rounded-lg border border-edge";

const segmentClass =
  "flex items-center gap-1.5 px-2 py-1 font-mono text-[0.65rem] font-semibold cursor-pointer transition-colors";

const ModeControl: Component = () => {
  const view = useViewPosture();

  /** Which segment is lit: the layout the host's canvas is in. */
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
