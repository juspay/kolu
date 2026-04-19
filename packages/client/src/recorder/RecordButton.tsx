/** Workspace record button. Idle: single RecordIcon that opens the setup
 *  popover. Recording/paused: three-button cluster — pause toggle, a
 *  status pill (click to stop), and a webcam toggle. */

import { type Component, Match, Switch, Show } from "solid-js";
import { isRecordingSupported, useRecorder } from "./useRecorder";
import RecordPopover from "./RecordPopover";
import LevelMeter from "./LevelMeter";
import { RecordIcon, PauseIcon, ResumeIcon, WebcamIcon } from "../ui/Icons";
import Tip from "../ui/Tip";
import { formatKeybind, SHORTCUTS } from "../input/keyboard";

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const RecordButton: Component = () => {
  if (!isRecordingSupported()) return null;
  const recorder = useRecorder();
  let triggerRef: HTMLButtonElement | undefined;

  const isActive = () =>
    recorder.phase() === "recording" || recorder.phase() === "paused";

  const idleLabel = () => {
    if (recorder.phase() === "setup") return "Recording setup";
    return "Record workspace";
  };

  const onIdleClick = () => {
    if (recorder.phase() === "setup") recorder.cancelSetup();
    else void recorder.openSetup();
  };

  const pauseLabel = () =>
    recorder.phase() === "paused"
      ? `Resume (${formatKeybind(SHORTCUTS.toggleRecordingPause.keybind)})`
      : `Pause (${formatKeybind(SHORTCUTS.toggleRecordingPause.keybind)})`;

  return (
    <>
      <Show
        when={isActive()}
        fallback={
          <div class="pointer-events-auto">
            <Tip label={idleLabel()}>
              <button
                ref={triggerRef}
                data-testid="record-toggle"
                data-phase={recorder.phase()}
                class="h-7 w-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                classList={{
                  "text-danger hover:bg-surface-2": recorder.phase() === "idle",
                  "bg-surface-2 text-danger": recorder.phase() === "setup",
                }}
                onClick={onIdleClick}
                aria-label={idleLabel()}
              >
                <RecordIcon />
              </button>
            </Tip>
          </div>
        }
      >
        <div
          class="pointer-events-auto flex items-center gap-1"
          data-testid="record-active"
          data-phase={recorder.phase()}
        >
          {/* Pause / resume */}
          <Tip label={pauseLabel()}>
            <button
              data-testid="record-pause"
              class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => recorder.togglePause()}
              aria-label={pauseLabel()}
            >
              <Switch>
                <Match when={recorder.phase() === "recording"}>
                  <PauseIcon />
                </Match>
                <Match when={recorder.phase() === "paused"}>
                  <ResumeIcon />
                </Match>
              </Switch>
            </button>
          </Tip>

          {/* Status pill — click to stop. Color shifts amber when paused
           *  so the frozen timer has an obvious explanation. */}
          <Tip label="Stop recording">
            <button
              data-testid="record-stop"
              class="h-7 flex items-center gap-1.5 px-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              classList={{
                "bg-danger/15 text-danger hover:bg-danger/25":
                  recorder.phase() === "recording",
                "bg-warning/15 text-warning hover:bg-warning/25":
                  recorder.phase() === "paused",
              }}
              onClick={() => void recorder.stop()}
              aria-label="Stop recording"
            >
              <span
                class="w-2 h-2 rounded-full"
                classList={{
                  "bg-danger animate-pulse": recorder.phase() === "recording",
                  "bg-warning": recorder.phase() === "paused",
                }}
              />
              <span class="text-xs tabular-nums">
                {formatElapsed(recorder.elapsedMs())}
              </span>
              <Show when={recorder.phase() === "recording"}>
                <LevelMeter level={recorder.micLevel()} class="h-1 w-10" />
              </Show>
              <Show when={recorder.phase() === "paused"}>
                <span class="text-xs font-medium uppercase tracking-wider">
                  Paused
                </span>
              </Show>
            </button>
          </Tip>

          {/* Webcam toggle — usable during recording and paused. */}
          <Tip label={recorder.webcamEnabled() ? "Hide webcam" : "Show webcam"}>
            <button
              data-testid="record-webcam"
              class="h-7 w-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              classList={{
                "bg-surface-2 text-fg": recorder.webcamEnabled(),
                "text-fg-2 hover:text-fg hover:bg-surface-2":
                  !recorder.webcamEnabled(),
              }}
              onClick={() => void recorder.toggleWebcam()}
              aria-label={
                recorder.webcamEnabled() ? "Hide webcam" : "Show webcam"
              }
              aria-pressed={recorder.webcamEnabled()}
            >
              <WebcamIcon />
            </button>
          </Tip>
        </div>
      </Show>
      <RecordPopover triggerRef={triggerRef} />
    </>
  );
};

export default RecordButton;
