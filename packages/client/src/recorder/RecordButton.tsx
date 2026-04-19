/** Workspace record button — lives in the ChromeBar's right cluster.
 *
 *  Idle: small red record dot. Recording: pulsing dot + elapsed mm:ss in a
 *  danger-tinted pill. Hidden on browsers without File System Access API. */

import { type Component, Show } from "solid-js";
import { isRecordingSupported, useRecorder } from "./useRecorder";
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
  const label = () =>
    recorder.isRecording() ? "Stop recording" : "Record workspace";
  return (
    <div class="pointer-events-auto">
      <Tip label={label()}>
        <button
          data-testid="record-toggle"
          data-recording={recorder.isRecording() ? "" : undefined}
          class="h-7 flex items-center gap-1.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          classList={{
            "w-7 justify-center text-danger hover:bg-surface-2":
              !recorder.isRecording(),
            "px-2 bg-danger/15 text-danger hover:bg-danger/25":
              recorder.isRecording(),
          }}
          onClick={() =>
            recorder.isRecording()
              ? void recorder.stop()
              : void recorder.start()
          }
          aria-label={label()}
        >
          <Show when={recorder.isRecording()} fallback={<RecordIcon />}>
            <span class="w-2 h-2 rounded-full bg-danger animate-pulse" />
            <span class="text-xs tabular-nums">
              {formatElapsed(recorder.elapsedMs())}
            </span>
          </Show>
        </button>
      </Tip>
    </div>
  );
};

export default RecordButton;
