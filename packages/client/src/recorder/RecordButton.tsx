/** Workspace record button. Opens a setup popover from idle (mic select
 *  + level meter); while recording, shows a pulsing danger pill with
 *  elapsed time and a mini level meter. Hidden when the File System
 *  Access API isn't available. */

import { type Component, Show, Match, Switch } from "solid-js";
import { isRecordingSupported, useRecorder } from "./useRecorder";
import RecordPopover from "./RecordPopover";
import LevelMeter from "./LevelMeter";
import { RecordIcon } from "../ui/Icons";
import Tip from "../ui/Tip";

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

  const label = () => {
    if (recorder.phase() === "recording") return "Stop recording";
    if (recorder.phase() === "setup") return "Recording setup";
    return "Record workspace";
  };

  const onClick = () => {
    if (recorder.phase() === "recording") void recorder.stop();
    else if (recorder.phase() === "setup") recorder.cancelSetup();
    else void recorder.openSetup();
  };

  return (
    <>
      <div class="pointer-events-auto">
        <Tip label={label()}>
          <button
            ref={triggerRef}
            data-testid="record-toggle"
            data-phase={recorder.phase()}
            class="h-7 flex items-center gap-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            classList={{
              "w-7 justify-center text-danger hover:bg-surface-2":
                recorder.phase() === "idle",
              "px-2 bg-surface-2 text-danger": recorder.phase() === "setup",
              "px-2 bg-danger/15 text-danger hover:bg-danger/25":
                recorder.phase() === "recording",
            }}
            onClick={onClick}
            aria-label={label()}
          >
            <Switch fallback={<RecordIcon />}>
              <Match when={recorder.phase() === "recording"}>
                <span class="w-2 h-2 rounded-full bg-danger animate-pulse" />
                <span class="text-xs tabular-nums">
                  {formatElapsed(recorder.elapsedMs())}
                </span>
                <Show when={recorder.micLevel() >= 0}>
                  <LevelMeter level={recorder.micLevel()} class="h-1 w-10" />
                </Show>
              </Match>
              <Match when={recorder.phase() === "setup"}>
                <RecordIcon />
              </Match>
            </Switch>
          </button>
        </Tip>
      </div>
      <RecordPopover triggerRef={triggerRef} />
    </>
  );
};

export default RecordButton;
