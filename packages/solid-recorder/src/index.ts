/** `@kolu/solid-recorder` — Solid-native browser tab + mic (+
 *  webcam) recording. See `./README.md`. */

export { default as LevelMeter } from "./LevelMeter";
export {
  closeMicPreview,
  mic,
  micPreviewStream,
  openMicPreview,
  setMicDevices,
  setMicSelectedId,
} from "./mic";
export {
  configureRecorderNotifications,
  formatElapsed,
  isRecordingSupported,
  type Phase,
  type RecorderNotifications,
  type StartRecordingOptions,
  useRecorder,
} from "./useRecorder";
export { default as WebcamOverlay } from "./WebcamOverlay";
export {
  changeWebcam,
  closeWebcam,
  openWebcam,
  setWebcamDevices,
  toggleWebcam,
  type WebcamState,
  webcam,
} from "./webcam";
