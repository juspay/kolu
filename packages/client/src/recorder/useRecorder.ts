/** Workspace screen + mic (+ optional webcam) recording with pre-record
 *  setup and pause/resume.
 *
 *  Capture target: the current browser tab via
 *  `getDisplayMedia({ preferCurrentTab: true, selfBrowserSurface: "include" })`.
 *  The browser's multi-surface picker collapses to a single "Share this
 *  tab" confirmation. The recording contains the whole Kolu UI — chrome
 *  bar, pill tree, canvas, and (if enabled) a fixed-corner webcam overlay
 *  baked into the DOM. If the user wants to record one terminal they
 *  just maximize it first.
 *
 *  Phases:
 *    idle     → nothing going on.
 *    setup    → mic stream open for device preview + level meter.
 *               Optional webcam stream open if the user toggled it on.
 *    recording → MediaRecorder streams 2s WebM (VP9/Opus) chunks into
 *               the FSA-picked file handle.
 *    paused   → MediaRecorder.pause() — no chunks emitted; elapsed timer
 *               freezes. Webcam + mic streams stay open for preview
 *               continuity.
 *
 *  Chromium-only by design (`showSaveFilePicker`, `preferCurrentTab`,
 *  FSA). `isRecordingSupported()` hides entry points elsewhere.
 *
 *  Structure: this file owns recording-session lifecycle + phase + the
 *  elapsed-time clock, and re-exports a flat facade via `useRecorder()`.
 *  Mic and webcam domains live in their own modules. */

import fixWebmDuration from "fix-webm-duration";
import { batch, createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { match, P } from "ts-pattern";
import {
  closeMicPreview,
  mic,
  micPreviewStream,
  openMicPreview,
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

/** Recording clock. `anchor` is the logical start; `pausedAt` freezes
 *  the clock while paused; `now` ticks from a 1Hz interval while live.
 *  `elapsedMs` is a memo over the three — no explicit setter, no
 *  ordering discipline. */
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
    startRecording,
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

/** Populate both device lists. Labels are only populated after the
 *  relevant getUserMedia permission has been granted. */
async function refreshDevices(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    setMicDevices(all.filter((d) => d.kind === "audioinput"));
    setWebcamDevices(all.filter((d) => d.kind === "videoinput"));
  } catch {
    // Leave current lists as-is — an enumeration failure shouldn't wipe
    // a previously-populated list.
  }
}

async function openSetup(): Promise<void> {
  if (phase() !== "idle") return;
  setPhase("setup");
  try {
    await openMicPreview(mic.selectedId());
    await refreshDevices();
  } catch (err) {
    if (!isAbort(err)) toast.error(`Microphone: ${errMsg(err)}`);
    setPhase("idle");
  }
}

async function changeMic(deviceId: string): Promise<void> {
  if (phase() !== "setup") return;
  setMicSelectedId(deviceId);
  try {
    await openMicPreview(deviceId);
  } catch (err) {
    if (!isAbort(err)) toast.error(`Microphone: ${errMsg(err)}`);
  }
}

function cancelSetup(): void {
  if (phase() !== "setup") return;
  closeMicPreview();
  closeWebcam();
  setPhase("idle");
}

async function startRecording(): Promise<void> {
  if (phase() !== "setup") return;
  const preview = micPreviewStream();
  if (!preview) return;

  const displayTracks: MediaStreamTrack[] = [];
  let openedWritable: FileSystemWritableFileStream | null = null;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `kolu-${timestamp()}.webm`,
      types: [
        { description: "WebM video", accept: { "video/webm": [".webm"] } },
      ],
    });
    const writable = await handle.createWritable();
    openedWritable = writable;

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      systemAudio: "exclude",
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
    // Browser's own "stop sharing" bar ends the video track — treat it
    // like a normal stop so the file closes cleanly.
    display
      .getVideoTracks()[0]
      ?.addEventListener("ended", () => void stopRecording(), { once: true });

    session = {
      recorder,
      handle,
      writable,
      tracks: [...displayTracks, ...preview.getTracks()],
    };
    openedWritable = null; // ownership transferred to `session`
    batch(() => {
      setAnchor(performance.now());
      setPausedAt(null);
      setNow(performance.now());
    });
    startTicker();
    setPhase("recording");
    recorder.start(TIMESLICE_MS);
    toast.success("Recording started");
  } catch (err) {
    for (const t of displayTracks) t.stop();
    if (openedWritable) await openedWritable.close().catch(() => {});
    if (!isAbort(err)) toast.error(`Recording failed: ${errMsg(err)}`);
  }
}

function togglePause(): void {
  const s = session;
  if (!s) return;
  match(phase())
    .with("recording", () => {
      // Belt-and-suspenders pause: pause the encoder AND disable every
      // source track so nothing sneaks through under browsers' varying
      // interpretations of the paused state.
      try {
        s.recorder.pause();
      } catch (err) {
        toast.error(`Pause failed: ${errMsg(err)}`);
        return;
      }
      for (const t of s.tracks) t.enabled = false;
      stopTicker();
      setPausedAt(performance.now());
      setPhase("paused");
    })
    .with("paused", () => {
      for (const t of s.tracks) t.enabled = true;
      try {
        s.recorder.resume();
      } catch (err) {
        toast.error(`Resume failed: ${errMsg(err)}`);
        return;
      }
      // Rewind anchor by the paused duration so the memo picks back up
      // from where it froze.
      batch(() => {
        const p = pausedAt();
        const a = anchor();
        if (p !== null && a !== null) {
          setAnchor(performance.now() - (p - a));
        }
        setPausedAt(null);
        setNow(performance.now());
      });
      startTicker();
      setPhase("recording");
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

async function stopRecording(): Promise<void> {
  const s = session;
  if (!s) return;
  session = null;
  setPhase("idle");
  stopTicker();

  // Capture ms-precise duration BEFORE zeroing the clock (the memo's
  // last cached value is up to 1s stale at a sub-second ticker).
  const durationMs =
    (pausedAt() ?? performance.now()) - (anchor() ?? performance.now());
  batch(() => {
    setAnchor(null);
    setPausedAt(null);
  });

  // Race-safe recorder shutdown. If `state` is already "inactive" (e.g.
  // the display track ended and re-entered stopRecording after
  // MediaRecorder auto-stopped), calling stop() throws AND the stop
  // event has already fired — a naive `await new Promise(...)` would
  // hang forever, blocking cleanup and leaking the mic stream.
  if (s.recorder.state !== "inactive") {
    await new Promise<void>((resolve) => {
      s.recorder.addEventListener("stop", () => resolve(), { once: true });
      try {
        s.recorder.stop();
      } catch {
        resolve();
      }
    });
  }
  for (const t of s.tracks) t.stop();
  closeMicPreview();
  closeWebcam();

  try {
    await s.writable.close();

    // Chrome's MediaRecorder streams WebM without a SegmentInfo.Duration
    // header — players show ~1 second. Read back, patch, rewrite.
    const raw = await s.handle.getFile();
    let out: Blob = raw;
    try {
      out = await fixWebmDuration(raw, durationMs);
    } catch (err) {
      toast.warning(`Duration patch failed: ${errMsg(err)}`);
    }
    const patched = await s.handle.createWritable();
    await patched.write(out);
    await patched.close();

    toast.success(`Recording saved · ${formatElapsed(durationMs)}`, {
      description: s.handle.name,
    });
  } catch (err) {
    toast.error(`Save failed: ${errMsg(err)}`);
  }
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
