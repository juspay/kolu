/** Workspace screen + mic recording.
 *
 *  Flow: save-as picker → screen picker (tab/window/screen) → mic prompt.
 *  A `MediaRecorder` streams 2-second WebM chunks directly into the file
 *  handle via the File System Access API, so memory stays flat regardless
 *  of recording length.
 *
 *  Chromium-only by design — `showSaveFilePicker` isn't in Firefox/Safari,
 *  and we deliberately skip in-memory fallbacks to keep the code simple.
 *  `isRecordingSupported()` gates the UI so the button is hidden elsewhere. */

import { createSignal } from "solid-js";
import { toast } from "solid-sonner";

// File System Access API's `showSaveFilePicker` is not in lib.dom yet.
// The handle/writable types are, so we only need to declare the entry point.
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
}

const MIME = "video/webm;codecs=vp9,opus";
const TIMESLICE_MS = 2000;

const [isRecording, setIsRecording] = createSignal(false);
const [elapsedMs, setElapsedMs] = createSignal(0);

interface Active {
  recorder: MediaRecorder;
  writable: FileSystemWritableFileStream;
  tracks: MediaStreamTrack[];
  ticker: number;
}

let active: Active | null = null;

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
    isRecording,
    elapsedMs,
    start,
    stop,
  };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function start(): Promise<void> {
  if (active) return;

  let sink: FileSystemWritableFileStream | null = null;
  const tracks: MediaStreamTrack[] = [];
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `kolu-${timestamp()}.webm`,
      types: [
        { description: "WebM video", accept: { "video/webm": [".webm"] } },
      ],
    });
    sink = await handle.createWritable();
    const writable = sink;

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    tracks.push(...display.getTracks());

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    tracks.push(...mic.getTracks());

    const stream = new MediaStream([
      ...display.getVideoTracks(),
      ...mic.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(stream, { mimeType: MIME });
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) void writable.write(ev.data);
    };
    // Browser's own "stop sharing" bar ends the video track — treat it
    // like a normal stop so the file is closed cleanly.
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      void stop();
    });

    const startedAt = performance.now();
    const ticker = window.setInterval(
      () => setElapsedMs(performance.now() - startedAt),
      250,
    );
    active = { recorder, writable, tracks, ticker };
    setElapsedMs(0);
    setIsRecording(true);
    recorder.start(TIMESLICE_MS);
    toast.success("Recording started");
  } catch (err) {
    for (const t of tracks) t.stop();
    if (sink) await sink.close().catch(() => {});
    if (!isAbort(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Recording failed: ${msg}`);
    }
  }
}

async function stop(): Promise<void> {
  const a = active;
  if (!a) return;
  active = null;
  setIsRecording(false);
  clearInterval(a.ticker);
  setElapsedMs(0);

  await new Promise<void>((resolve) => {
    a.recorder.addEventListener("stop", () => resolve(), { once: true });
    try {
      a.recorder.stop();
    } catch {
      resolve();
    }
  });
  for (const t of a.tracks) t.stop();
  try {
    await a.writable.close();
    toast.success("Recording saved");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.error(`Save failed: ${msg}`);
  }
}
