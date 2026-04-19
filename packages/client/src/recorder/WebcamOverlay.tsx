/** Fixed-corner webcam overlay (picture-in-picture).
 *
 *  Renders a small mirrored `<video>` in the bottom-right of the viewport
 *  whenever the recorder has a live webcam stream. Because we capture the
 *  whole tab via `getDisplayMedia`, the browser already bakes this DOM
 *  element into the recording — no offscreen compositing required.
 *
 *  Visible across all phases that own a webcam stream: setup, recording,
 *  paused. The recorder closes the stream on stop or when the user
 *  toggles webcam off, which unmounts the overlay. */

import { type Component, Show, createEffect } from "solid-js";
import { useRecorder } from "./useRecorder";

const WebcamOverlay: Component = () => {
  const recorder = useRecorder();
  let videoRef: HTMLVideoElement | undefined;

  // Reassign srcObject whenever the stream changes. Setting it via JSX
  // attribute doesn't work for MediaStream — has to be imperative.
  createEffect(() => {
    const s = recorder.webcamStream();
    if (videoRef) videoRef.srcObject = s;
  });

  return (
    <Show when={recorder.webcamStream()}>
      <div
        data-testid="webcam-overlay"
        class="fixed bottom-5 right-5 z-40 w-44 h-44 rounded-full overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10 pointer-events-none"
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
