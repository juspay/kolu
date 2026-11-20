import { Effect } from "effect";
import fixWebmDuration from "fix-webm-duration";
import { batch, createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { match, P } from "ts-pattern";
import { runAction, type UiAction } from "../runAction";
import {
  closeMicPreview,
  mic,
  micPreviewStream,
  openMicPreviewFromGesture,
  setMicDevices,
  setMicSelectedId,
} from "./mic";
import {
  changeWebcam,
  closeWebcam,
  setWebcamDevices,
  toggleWebcam,
  webcam,
} from "./webcam";

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string | string[]>;
  }>;
}
declare global {
  interface Window {
    showSaveFilePicker(
      options?: SaveFilePickerOptions,
    ): Promise<FileSystemFileHandle>;
  }
  interface MediaDevices {
    getDisplayMedia(
      constraints?: DisplayMediaStreamOptions & {
        preferCurrentTab?: boolean;
        selfBrowserSurface?: "include" | "exclude";
        systemAudio?: "include" | "exclude";
      },
    ): Promise<MediaStream>;
  }
}

const MIME = "video/webm;codecs=vp9,opus";
const TIMESLICE_MS = 2000;

export type Phase = "idle" | "setup" | "recording" | "paused";

const [phase, setPhase] = createSignal<Phase>("idle");

const [anchor, setAnchor] = createSignal<number | null>(null);
const [pausedAt, setPausedAt] = createSignal<number | null>(null);
const [now, setNow] = createSignal(performance.now());

const elapsedMs = createMemo<number>(() => {
  const a = anchor();
  if (a === null) return 0;
  return (pausedAt() ?? now()) - a;
});

interface Session {
  recorder: MediaRecorder;
  handle: FileSystemFileHandle;
  writable: FileSystemWritableFileStream;
  tracks: MediaStreamTrack[];
}
let session: Session | null = null;
let ticker: number | null = null;

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showSaveFilePicker === "function" &&
    !!navigator.mediaDevices?.getDisplayMedia &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported(MIME)
  );
}

export function useRecorder() {
  return {
    phase,
    elapsedMs,
    micDevices: mic.devices,
    micDeviceId: mic.selectedId,
    micLevel: mic.level,
    micError: mic.errorMessage,
    webcamEnabled: webcam.enabled,
    webcamStream: webcam.stream,
    webcamDevices: webcam.devices,
    webcamDeviceId: webcam.selectedId,
    webcamError: webcam.errorMessage,
    openSetup,
    changeMic,
    toggleWebcam,
    changeWebcam,
    cancelSetup,
    startRecordingFromGesture,
    togglePause,
    stop: stopRecording,
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const refreshDevices: UiAction = Effect.tryPromise(() =>
  navigator.mediaDevices.enumerateDevices(),
).pipe(
  Effect.tap((all) =>
    Effect.sync(() => {
      setMicDevices(all.filter((d) => d.kind === "audioinput"));
      setWebcamDevices(all.filter((d) => d.kind === "videoinput"));
    }),
  ),
  Effect.ignore,
);

const toastUnlessDismissed = <A>(
  self: Effect.Effect<A, unknown>,
): Effect.Effect<A | undefined, never> =>
  Effect.catch(self, (err) =>
    Effect.sync(() => {
      if (!isAbort(err)) toast.error(`Microphone: ${errMsg(err)}`);
      return undefined;
    }),
  );

function openSetup(): UiAction {
  return Effect.suspend(() => {
    if (phase() !== "idle") return Effect.void;
    setPhase("setup");
    return openMicPreviewFromGesture(mic.selectedId()).pipe(
      Effect.andThen(() => refreshDevices),
      Effect.tapError(() => Effect.sync(() => setPhase("idle"))),
      toastUnlessDismissed,
    );
  });
}

function changeMic(deviceId: string): UiAction {
  return Effect.suspend(() => {
    if (phase() !== "setup") return Effect.void;
    setMicSelectedId(deviceId);
    return openMicPreviewFromGesture(deviceId).pipe(toastUnlessDismissed);
  });
}

function cancelSetup(): void {
  if (phase() !== "setup") return;
  closeMicPreview();
  closeWebcam();
  setPhase("idle");
}

function startRecordingFromGesture(): UiAction {
  return Effect.suspend(() => {
    if (phase() !== "setup") return Effect.void;
    const preview = micPreviewStream();
    if (!preview) return Effect.void;

    const displayTracks: MediaStreamTrack[] = [];
    let openedWritable: FileSystemWritableFileStream | null = null;

    return Effect.gen(function* () {
      const handle = yield* Effect.tryPromise({
        try: () =>
          window.showSaveFilePicker({
            suggestedName: `kolu-${timestamp()}.webm`,
            types: [
              {
                description: "WebM video",
                accept: { "video/webm": [".webm"] },
              },
            ],
          }),
        catch: (e) => e,
      });
      const writable = yield* Effect.tryPromise({
        try: () => handle.createWritable(),
        catch: (e) => e,
      });
      openedWritable = writable;

      const display = yield* Effect.tryPromise({
        try: () =>
          navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: "include",
            systemAudio: "exclude",
          }),
        catch: (e) => e,
      });
      displayTracks.push(...display.getTracks());

      const stream = new MediaStream([
        ...display.getVideoTracks(),
        ...preview.getAudioTracks(),
      ]);
      const recorder = new MediaRecorder(stream, { mimeType: MIME });
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) void writable.write(ev.data);
      };
      display
        .getVideoTracks()[0]
        ?.addEventListener(
          "ended",
          () => runAction("stop recording", stopRecording()),
          { once: true },
        );

      session = {
        recorder,
        handle,
        writable,
        tracks: [...displayTracks, ...preview.getTracks()],
      };
      openedWritable = null;
      batch(() => {
        setAnchor(performance.now());
        setPausedAt(null);
        setNow(performance.now());
        setPhase("recording");
      });
      startTicker();
      recorder.start(TIMESLICE_MS);
      toast.success("Recording started");
    }).pipe(
      Effect.catch((err) =>
        Effect.gen(function* () {
          for (const t of displayTracks) t.stop();
          const stray = openedWritable;
          if (stray)
            yield* Effect.tryPromise(() => stray.close()).pipe(Effect.ignore);
          if (!isAbort(err)) toast.error(`Recording failed: ${errMsg(err)}`);
        }),
      ),
    );
  });
}

function pauseEncoderAndTracks(s: Session): void {
  s.recorder.pause();
  for (const t of s.tracks) t.enabled = false;
}

function resumeEncoderAndTracks(s: Session): void {
  for (const t of s.tracks) t.enabled = true;
  s.recorder.resume();
}

function togglePause(): void {
  const s = session;
  if (!s) return;
  match(phase())
    .with("recording", () => {
      try {
        pauseEncoderAndTracks(s);
      } catch (err) {
        toast.error(`Pause failed: ${errMsg(err)}`);
        return;
      }
      stopTicker();
      batch(() => {
        setPausedAt(performance.now());
        setPhase("paused");
      });
    })
    .with("paused", () => {
      try {
        resumeEncoderAndTracks(s);
      } catch (err) {
        toast.error(`Resume failed: ${errMsg(err)}`);
        return;
      }
      batch(() => {
        const p = pausedAt();
        const a = anchor();
        if (p !== null && a !== null) {
          setAnchor(performance.now() - (p - a));
        }
        setPausedAt(null);
        setNow(performance.now());
        setPhase("recording");
      });
      startTicker();
    })
    .with(P.union("idle", "setup"), () => {})
    .exhaustive();
}

function startTicker(): void {
  stopTicker();
  ticker = window.setInterval(() => setNow(performance.now()), 1000);
}

function stopTicker(): void {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function awaitRecorderStopped(
  recorder: MediaRecorder,
): Effect.Effect<void, never> {
  if (recorder.state === "inactive") return Effect.void;
  return Effect.callback<void>((resume) => {
    recorder.addEventListener("stop", () => resume(Effect.void), {
      once: true,
    });
    try {
      recorder.stop();
    } catch {
      resume(Effect.void);
    }
  });
}

function stopRecording(): UiAction {
  return Effect.suspend(() => {
    const s = session;
    if (!s) return Effect.void;
    session = null;
    setPhase("idle");
    stopTicker();

    const durationMs =
      (pausedAt() ?? performance.now()) - (anchor() ?? performance.now());
    batch(() => {
      setAnchor(null);
      setPausedAt(null);
    });

    return awaitRecorderStopped(s.recorder).pipe(
      Effect.andThen(() =>
        Effect.gen(function* () {
          for (const t of s.tracks) t.stop();
          closeMicPreview();
          closeWebcam();

          yield* Effect.tryPromise({
            try: () => s.writable.close(),
            catch: (e) => e,
          });

          // Chrome's MediaRecorder streams WebM without a SegmentInfo.Duration
          // header — players show ~1 second. Read back, patch, rewrite.
          const raw = yield* Effect.tryPromise({
            try: () => s.handle.getFile(),
            catch: (e) => e,
          });
          const out = yield* Effect.tryPromise({
            try: () => fixWebmDuration(raw, durationMs),
            catch: (e) => e,
          }).pipe(
            Effect.catch((err) =>
              Effect.sync((): Blob => {
                toast.warning(`Duration patch failed: ${errMsg(err)}`);
                return raw;
              }),
            ),
          );
          const patched = yield* Effect.tryPromise({
            try: () => s.handle.createWritable(),
            catch: (e) => e,
          });
          yield* Effect.tryPromise({
            try: () => patched.write(out),
            catch: (e) => e,
          });
          yield* Effect.tryPromise({
            try: () => patched.close(),
            catch: (e) => e,
          });

          toast.success(`Recording saved · ${formatElapsed(durationMs)}`, {
            description: s.handle.name,
          });
        }).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(`Save failed: ${errMsg(err)}`);
            }),
          ),
        ),
      ),
    );
  });
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
