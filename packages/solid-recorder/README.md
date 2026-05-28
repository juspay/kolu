# @kolu/solid-recorder

Solid-native browser tab + mic (+ optional webcam) recording — the
state machine, mic level meter, webcam stream management, and the
WebM-duration patch wrapped into a single `useRecorder()` hook.

Chromium-only by design: depends on `showSaveFilePicker` (File
System Access), `preferCurrentTab` getDisplayMedia, and the VP9/Opus
WebM codec. `isRecordingSupported()` returns false elsewhere so
callers can hide entry points.

## What's in the package

- `useRecorder()` — orchestrator hook returning phase, elapsed
  clock, device lists, and lifecycle methods (`openSetup`,
  `changeMic`, `toggleWebcam`, `changeWebcam`, `cancelSetup`,
  `startRecording`, `togglePause`, `stop`). Accepts optional
  notification callbacks (`onError`, `onSuccess`, `onWarning`)
  defaulting to `console.*` — callers wire `solid-sonner` (or
  whatever) through these.
- `mic` — singleton mic device state + RMS level meter via
  Web Audio.
- `webcam` — singleton webcam device state with discriminated-union
  lifecycle (`off | loading | error | active`).
- `LevelMeter` — generic visual level meter (5 segments).
- `WebcamOverlay` — fixed-corner webcam preview that mirrors and
  fades on `prefers-reduced-motion`.
- `isRecordingSupported()` — capability probe.

## What stays in the consuming app

- The `Record` button / popover UI (keybind binding,
  app-specific styling, toast provider wiring).
- The `suggestedName` passed to `startRecording({ suggestedName })` —
  required, no framework-sensible default.

## Encapsulated axis

Browser media-capture lifecycle: setup → recording → paused → idle,
plus mic/webcam stream management and the WebM duration patch. This
axis has already changed (FSA, `preferCurrentTab`, codec
availability) and will change again — the framework absorbs the
churn so consumers don't.

## Why a package

Single in-tree consumer (Kolu) today; same single-consumer bar
Surface, `@kolu/solid-pierre`, `@kolu/solid-xterm`, and the canvas
packages cleared. The extraction removes Kolu-specific identity
(toast as the error channel, `kolu-${ts}.webm` as the default
filename) from would-be-framework code, leaving a stable API for
the next consumer (Kolu second app, dogfood examples, external).
