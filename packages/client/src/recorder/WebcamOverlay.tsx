import { type Component, createEffect, Show } from "solid-js";
import { useRecorder } from "./useRecorder";

const WebcamOverlay: Component = () => {
  const recorder = useRecorder();
  let videoRef: HTMLVideoElement | undefined;

  createEffect(() => {
    const s = recorder.webcamStream();
    if (videoRef) videoRef.srcObject = s;
  });

  return (
    <Show when={recorder.webcamStream()}>
      <div
        data-testid="webcam-overlay"
        class="fixed bottom-5 right-5 z-[45] w-44 h-44 rounded-full overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10 pointer-events-none"
      >
        <video
          ref={videoRef}
          autoplay
          muted
          playsinline
          class="w-full h-full object-cover scale-x-[-1]"
        />
      </div>
    </Show>
  );
};

export default WebcamOverlay;
