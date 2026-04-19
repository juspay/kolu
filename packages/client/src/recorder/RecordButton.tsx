/** Workspace record button.
 *
 *  Two visual states:
 *
 *    idle / setup  — a single 28×28 square holding the camcorder icon.
 *    recording /   — a segmented capsule: [pause · dot+time · webcam].
 *    paused         When live, a soft outer halo breathes outward
 *                   (see `.record-capsule-live` in index.css). When
 *                   paused, the capsule shifts red→amber and the halo
 *                   is suppressed; the middle section reads "PAUSED"
 *                   in place of the level strip.
 *
 *  Click targets: the pause/webcam ends toggle their respective state;
 *  the middle section is the stop button. Keyboard: `⌘⇧.` toggles
 *  pause↔resume (registered as `toggleRecordingPause`).
 *
 *  Hidden when the File System Access API isn't available. */

import { type Component, Match, Switch, Show } from "solid-js";
import { isRecordingSupported, useRecorder } from "./useRecorder";
import RecordPopover from "./RecordPopover";
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
  const isLive = () => recorder.phase() === "recording";
  const isPaused = () => recorder.phase() === "paused";

  const idleLabel = () =>
    recorder.phase() === "setup" ? "Recording setup" : "Record workspace";

  const onIdleClick = () => {
    console.log("[recorder] RecordButton.onIdleClick", {
      phase: recorder.phase(),
    });
    if (recorder.phase() === "setup") recorder.cancelSetup();
    else void recorder.openSetup();
  };

  const pauseLabel = () =>
    isPaused()
      ? `Resume (${formatKeybind(SHORTCUTS.toggleRecordingPause.keybind)})`
      : `Pause (${formatKeybind(SHORTCUTS.toggleRecordingPause.keybind)})`;

  const webcamLabel = () =>
    recorder.webcamEnabled() ? "Hide webcam" : "Show webcam";

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
        {/* Segmented capsule. Internal dividers come from `divide-x`
         *  tinted to match the current (live/paused) accent. The
         *  capsule itself owns the halo animation — children handle
         *  only their hover states. */}
        <div
          data-testid="record-active"
          data-phase={recorder.phase()}
          class="pointer-events-auto flex items-stretch h-7 rounded-lg overflow-hidden"
          classList={{
            "bg-danger/10 divide-x divide-danger/20 record-capsule-live":
              isLive(),
            "bg-warning/10 divide-x divide-warning/25": isPaused(),
          }}
        >
          {/* Pause / resume */}
          <Tip label={pauseLabel()} class="flex">
            <button
              data-testid="record-pause"
              class="w-7 flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              classList={{
                "text-danger hover:bg-danger/15": isLive(),
                "text-warning hover:bg-warning/20": isPaused(),
              }}
              onClick={() => recorder.togglePause()}
              aria-label={pauseLabel()}
            >
              <Switch>
                <Match when={isLive()}>
                  <PauseIcon />
                </Match>
                <Match when={isPaused()}>
                  <ResumeIcon />
                </Match>
              </Switch>
            </button>
          </Tip>

          {/* Status section — the whole segment is the stop button.
           *  Live: static dot + elapsed mm:ss.
           *  Paused: tiny "PAUSED" caps chip + frozen elapsed. */}
          <Tip label="Stop recording" class="flex">
            <button
              data-testid="record-stop"
              class="flex items-center gap-1.5 px-2.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              classList={{
                "text-danger hover:bg-danger/15": isLive(),
                "text-warning hover:bg-warning/20": isPaused(),
              }}
              onClick={() => void recorder.stop()}
              aria-label="Stop recording"
            >
              <span
                class="w-1.5 h-1.5 rounded-full"
                classList={{
                  "bg-danger": isLive(),
                  "bg-warning": isPaused(),
                }}
              />
              <Show when={isPaused()}>
                <span class="text-[0.625rem] font-semibold uppercase tracking-[0.12em] leading-none">
                  Paused
                </span>
              </Show>
              <span class="text-xs font-medium tabular-nums leading-none">
                {formatElapsed(recorder.elapsedMs())}
              </span>
            </button>
          </Tip>

          {/* Webcam toggle — end cap. */}
          <Tip label={webcamLabel()} class="flex">
            <button
              data-testid="record-webcam"
              class="w-7 flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              classList={{
                "text-danger hover:bg-danger/15":
                  isLive() && !recorder.webcamEnabled(),
                "text-danger bg-danger/15":
                  isLive() && recorder.webcamEnabled(),
                "text-warning hover:bg-warning/20":
                  isPaused() && !recorder.webcamEnabled(),
                "text-warning bg-warning/20":
                  isPaused() && recorder.webcamEnabled(),
              }}
              onClick={() => void recorder.toggleWebcam()}
              aria-label={webcamLabel()}
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
