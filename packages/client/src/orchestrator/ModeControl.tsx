/** The three faces of the workspace, as one control.
 *
 *  `canvas` and `maximized` are the two POSTURES; `orchestrator` is the third
 *  axis laid over them. Spelling all three as one segmented control is what
 *  makes the relationship legible — they are mutually exclusive views, and a
 *  separate maximize button beside a separate orchestrator toggle would let a
 *  person build a state the layout does not have.
 *
 *  In canvas and maximized modes the orchestrator has NO panel: this entry is
 *  the whole of it, and the violet badge is how many of its questions are
 *  waiting. The badge counts `openAsks` on the ACTIVE host — the other hosts'
 *  asks ride their own host tab's marks, which is where a cross-host count
 *  already lives. */

import { type Component, Show } from "solid-js";
import { useViewPosture } from "../canvas/useViewPosture";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";
import { encActiveHost } from "../wire";
import {
  orchestratorStateOf,
  useOrchestratorFacts,
} from "./useOrchestratorFacts";
import {
  enterOrchestratorMode,
  exitOrchestratorMode,
  orchestratorMode,
} from "./useOrchestratorMode";

const segmentClass =
  "flex items-center gap-1.5 px-2 py-1 font-mono text-[0.65rem] font-semibold cursor-pointer transition-colors";

const ModeControl: Component = () => {
  const posture = useViewPosture();
  useOrchestratorFacts();

  const asks = () => orchestratorStateOf(encActiveHost()).openAsks.length;
  const mode = (): "canvas" | "maximized" | "orchestrator" =>
    orchestratorMode()
      ? "orchestrator"
      : posture.mode() === "maximized"
        ? "maximized"
        : "canvas";

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
          onClick={() => posture.postureTo(false)}
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
              mode() !== "maximized" && posture.canMaximize(),
            "text-fg-3/40 cursor-not-allowed": !posture.canMaximize(),
          }}
          disabled={!posture.canMaximize()}
          onClick={() => posture.postureTo(true)}
        >
          ▢ maximized
        </button>
      </Tip>
      <Tip
        label={`Orchestrator (${formatKeybind(ACTIONS.toggleOrchestrator.keybind)})`}
      >
        <button
          type="button"
          data-testid="mode-orchestrator"
          data-active={mode() === "orchestrator" ? "" : undefined}
          class={`${segmentClass} relative border-l border-edge`}
          classList={{
            "text-accent bg-accent/12": mode() === "orchestrator",
            "text-fg-3 hover:text-fg": mode() !== "orchestrator",
          }}
          onClick={() =>
            mode() === "orchestrator"
              ? exitOrchestratorMode()
              : enterOrchestratorMode()
          }
        >
          ◆ orchestrator
          {/* ABSENT at zero, never a `0` — a badge that renders its own silence
              is one every reader has to parse before ignoring. */}
          <Show when={asks() > 0}>
            <span
              data-testid="orchestrator-badge"
              class="absolute -top-1 -right-1 rounded-full bg-alert px-1.5 font-mono text-[0.6rem] font-bold text-surface-0"
            >
              {asks()}
            </span>
          </Show>
        </button>
      </Tip>
    </div>
  );
};

export default ModeControl;
