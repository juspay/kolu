/** Pre-record setup popover — mic + webcam device selectors, live level
 *  meter, webcam preview, "Start recording" commit button. Appears when
 *  the chrome-bar record button is clicked from idle. */

import { type Component, createEffect, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { surface } from "@kolu/solid-ui/Surface";
import Toggle from "@kolu/solid-ui/Toggle";
import { useAnchoredPopover } from "@kolu/solid-overlay";
import LevelMeter from "./LevelMeter";
import { useRecorder } from "./useRecorder";

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

  let webcamVideoRef: HTMLVideoElement | undefined;

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open,
    onDismiss: () => recorder.cancelSetup(),
    anchor: "bottom-end",
  });

  // Keep the preview `<video>` in sync with the webcam stream signal.
  createEffect(() => {
    const s = recorder.webcamStream();
    if (webcamVideoRef) webcamVideoRef.srcObject = s;
  });

  const showMicSelector = () => recorder.micDevices().length > 1;
  const showWebcamSelector = () => recorder.webcamDevices().length > 1;

  const selectedMicLabel = () => {
    const id = recorder.micDeviceId();
    const dev = recorder.micDevices().find((d) => d.deviceId === id);
    return dev?.label || "System default";
  };

  const chrome = surface({ portalled: true });

  return (
    <Show when={open()}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="record-popover"
          class={`fixed z-50 ${chrome.class} p-3 min-w-[280px] space-y-3`}
          style={{ ...panelStyle(), ...chrome.style }}
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
            <div class="flex items-center justify-between gap-3 text-xs text-fg-2 pt-2">
              <span>Webcam overlay</span>
              <Toggle
                testId="record-webcam-toggle"
                enabled={recorder.webcamEnabled()}
                onChange={() => {
                  void recorder.toggleWebcam();
                }}
              />
            </div>
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
              type="button"
              data-testid="record-cancel"
              class="h-7 px-3 text-sm text-fg-2 hover:text-fg rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => recorder.cancelSetup()}
            >
              Cancel
            </button>
            <button
              type="button"
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
