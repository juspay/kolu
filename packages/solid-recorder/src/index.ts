/** `@kolu/solid-recorder` — Solid-native browser tab + mic (+
 *  webcam) recording. See `./README.md`. */

export {
  closeMicPreview,
  mic,
  micPreviewStream,
  openMicPreview,
  setMicDevices,
  setMicSelectedId,
} from "./mic";
export {
  changeWebcam,
  closeWebcam,
  openWebcam,
  setWebcamDevices,
  toggleWebcam,
  webcam,
  type WebcamState,
} from "./webcam";
export {
  configureRecorderNotifications,
  formatElapsed,
  isRecordingSupported,
  type Phase,
  type RecorderNotifications,
  type StartRecordingOptions,
  useRecorder,
} from "./useRecorder";
export { default as LevelMeter } from "./LevelMeter";
export { default as WebcamOverlay } from "./WebcamOverlay";
