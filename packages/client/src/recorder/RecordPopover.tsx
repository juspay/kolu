/** Pre-record setup popover — mic + webcam device selectors, live level
 *  meter, webcam preview, "Start recording" commit button. Appears when
 *  the chrome-bar record button is clicked from idle. */

import {
  type Component,
  Show,
  For,
  createSignal,
  createEffect,
} from "solid-js";
import { Portal } from "solid-js/web";
import { makeEventListener } from "@solid-primitives/event-listener";
import { useRecorder } from "./useRecorder";
import LevelMeter from "./LevelMeter";
import Toggle from "../ui/Toggle";

const DeviceSelect: Component<{
  testId: string;
  devices: MediaDeviceInfo[];
  selectedId: string;
  fallbackLabel: (shortId: string) => string;
  onChange: (id: string) => void;
}> = (props) => (
  <select
    data-testid={props.testId}
    class="w-full h-7 px-2 text-sm bg-surface-2 border border-edge rounded-lg text-fg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    value={props.selectedId}
    onChange={(e) => props.onChange(e.currentTarget.value)}
  >
    <option value="default">System default</option>
    <For each={props.devices}>
      {(d) => (
        <Show when={d.deviceId && d.deviceId !== "default"}>
          <option value={d.deviceId}>
            {d.label || props.fallbackLabel(d.deviceId.slice(0, 6))}
          </option>
        </Show>
      )}
    </For>
  </select>
);

const RecordPopover: Component<{
  triggerRef?: HTMLElement;
}> = (props) => {
  const recorder = useRecorder();
  const open = () => recorder.phase() === "setup";

  let panelRef: HTMLDivElement | undefined;
  let webcamVideoRef: HTMLVideoElement | undefined;
  const [pos, setPos] = createSignal({ top: 0, right: 0 });

  const updatePos = () => {
    if (!props.triggerRef) return;
    const rect = props.triggerRef.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  // Reposition whenever the popover opens OR the trigger element
  // reference changes. With signal-backed trigger ref from RecordButton,
  // remounts of the idle button (after record↔idle cycles) flow through
  // here so the popover doesn't end up anchored to a detached element.
  createEffect(() => {
    if (open() && props.triggerRef) updatePos();
  });

  // Keep the preview `<video>` in sync with the webcam stream signal.
  createEffect(() => {
    const s = recorder.webcamStream();
    if (webcamVideoRef) webcamVideoRef.srcObject = s;
  });

  // Click outside → cancel setup. Ignore clicks on the trigger itself
  // so toggling-via-trigger doesn't double-dispatch.
  makeEventListener(document, "mousedown", (e) => {
    if (!open()) return;
    if (
      panelRef &&
      !panelRef.contains(e.target as Node) &&
      !props.triggerRef?.contains(e.target as Node)
    ) {
      recorder.cancelSetup();
    }
  });

  makeEventListener(document, "keydown", (e) => {
    if (open() && e.key === "Escape") recorder.cancelSetup();
  });

  const showMicSelector = () => recorder.micDevices().length > 1;
  const showWebcamSelector = () => recorder.webcamDevices().length > 1;

  const selectedMicLabel = () => {
    const id = recorder.micDeviceId();
    const dev = recorder.micDevices().find((d) => d.deviceId === id);
    return dev?.label || "System default";
  };

  return (
    <Show when={open()}>
      <Portal>
        <div
          ref={(el) => {
            panelRef = el;
            updatePos();
          }}
          data-testid="record-popover"
          class="fixed z-50 bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-3 min-w-[280px] space-y-3"
          style={{
            top: `${pos().top}px`,
            right: `${pos().right}px`,
            "background-color": "var(--color-surface-1)",
          }}
        >
          <div class="text-sm font-medium text-fg">Record workspace</div>

          {/* Mic */}
          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-xs text-fg-2">
              <span>Microphone</span>
              <Show when={recorder.micError()}>
                <span class="text-danger" data-testid="record-mic-error">
                  {recorder.micError()}
                </span>
              </Show>
            </div>
            <Show
              when={showMicSelector()}
              fallback={
                <div
                  class="text-sm text-fg-2 truncate"
                  title={selectedMicLabel()}
                >
                  {selectedMicLabel()}
                </div>
              }
            >
              <DeviceSelect
                testId="record-mic-select"
                devices={recorder.micDevices()}
                selectedId={recorder.micDeviceId()}
                fallbackLabel={(s) => `Microphone ${s}`}
                onChange={(id) => void recorder.changeMic(id)}
              />
            </Show>
            <LevelMeter level={recorder.micLevel()} class="h-2" />
          </div>

          {/* Webcam */}
          <div class="space-y-1.5 pt-1 border-t border-edge">
            <label class="flex items-center justify-between gap-3 cursor-pointer text-xs text-fg-2 pt-2">
              <span>Webcam overlay</span>
              <Toggle
                testId="record-webcam-toggle"
                enabled={recorder.webcamEnabled()}
                onChange={() => {
                  void recorder.toggleWebcam();
                }}
              />
            </label>
            <Show when={recorder.webcamError()}>
              <div
                class="text-xs text-danger"
                data-testid="record-webcam-error"
              >
                {recorder.webcamError()}
              </div>
            </Show>
            <Show when={recorder.webcamEnabled() && showWebcamSelector()}>
              <DeviceSelect
                testId="record-webcam-select"
                devices={recorder.webcamDevices()}
                selectedId={recorder.webcamDeviceId()}
                fallbackLabel={(s) => `Camera ${s}`}
                onChange={(id) => void recorder.changeWebcam(id)}
              />
            </Show>
            <Show when={recorder.webcamStream()}>
              <div class="flex justify-center py-1">
                <div class="w-32 h-32 rounded-full overflow-hidden ring-1 ring-edge bg-surface-2">
                  <video
                    ref={webcamVideoRef}
                    autoplay
                    muted
                    playsinline
                    class="w-full h-full object-cover scale-x-[-1]"
                  />
                </div>
              </div>
            </Show>
          </div>

          <div class="flex items-center justify-end gap-2 pt-1">
            <button
              data-testid="record-cancel"
              class="h-7 px-3 text-sm text-fg-2 hover:text-fg rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => recorder.cancelSetup()}
            >
              Cancel
            </button>
            <button
              data-testid="record-start"
              class="h-7 px-3 text-sm text-white bg-danger hover:bg-danger/90 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => {
                void recorder.startRecording();
              }}
            >
              Start recording
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default RecordPopover;
