/** Workspace screen + mic recording with pre-record mic setup.
 *
 *  Capture target: the current browser tab via
 *  `getDisplayMedia({ preferCurrentTab: true, selfBrowserSurface: "include" })`.
 *  That collapses the browser's multi-surface picker into a single
 *  "Share this tab" confirmation. The recording then contains the whole
 *  Kolu UI — chrome bar, pill tree, canvas, everything — so if the user
 *  wants to record a single terminal they just maximize it first.
 *
 *  Phases:
 *    idle     → nothing going on.
 *    setup    → mic stream is open for device preview + level meter.
 *               The user can pick a different mic before committing.
 *    recording → MediaRecorder is streaming 2s WebM (VP9/Opus) chunks
 *               directly into an FSA-picked file handle.
 *
 *  Chromium-only by design (`showSaveFilePicker`, `preferCurrentTab`,
 *  FSA). `isRecordingSupported()` hides the entry points elsewhere. */

import { createSignal } from "solid-js";
import { toast } from "solid-sonner";

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

type Phase = "idle" | "setup" | "recording";

const [phase, setPhase] = createSignal<Phase>("idle");
const [elapsedMs, setElapsedMs] = createSignal(0);
const [micDevices, setMicDevices] = createSignal<MediaDeviceInfo[]>([]);
const [micDeviceId, setMicDeviceIdSignal] = createSignal<string>("default");
const [micLevel, setMicLevel] = createSignal(0);
const [micError, setMicError] = createSignal<string | null>(null);

interface Preview {
  stream: MediaStream;
  ctx: AudioContext;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  raf: number;
  buf: Float32Array<ArrayBuffer>;
}
let preview: Preview | null = null;

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
    phase,
    elapsedMs,
    micDevices,
    micDeviceId,
    micLevel,
    micError,
    openSetup,
    changeMic,
    cancelSetup,
    startRecording,
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

/** Open a mic stream for the given deviceId and attach an AnalyserNode.
 *  Runs an rAF loop that publishes the current RMS level to `micLevel`
 *  (0..1, roughly). Re-entrant: closes any existing preview first. */
async function openPreview(deviceId: string): Promise<void> {
  closePreview();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
      video: false,
    });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    // Explicit ArrayBuffer backing keeps the narrow generic that
    // `getFloatTimeDomainData` expects in lib.dom.
    const buf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
    const tick = () => {
      if (!preview) return;
      preview.analyser.getFloatTimeDomainData(preview.buf);
      let sum = 0;
      for (let i = 0; i < preview.buf.length; i++) {
        const v = preview.buf[i]!;
        sum += v * v;
      }
      // Light nonlinear shaping so talking registers visibly without
      // clipping on louder syllables.
      const rms = Math.sqrt(sum / preview.buf.length);
      setMicLevel(Math.min(1, Math.pow(rms, 0.5) * 2));
      preview.raf = requestAnimationFrame(tick);
    };
    preview = {
      stream,
      ctx,
      analyser,
      source,
      raf: requestAnimationFrame(tick),
      buf,
    };
    setMicError(null);
  } catch (err) {
    setMicError(errMsg(err));
    throw err;
  }
}

function closePreview(): void {
  if (!preview) return;
  cancelAnimationFrame(preview.raf);
  preview.source.disconnect();
  void preview.ctx.close();
  for (const t of preview.stream.getTracks()) t.stop();
  preview = null;
  setMicLevel(0);
}

/** Populate the device list once permission is granted. Before the first
 *  successful getUserMedia, device labels are empty strings. */
async function refreshDevices(): Promise<void> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    setMicDevices(all.filter((d) => d.kind === "audioinput"));
  } catch {
    setMicDevices([]);
  }
}

/** Enter setup phase: open preview on the default mic, enumerate devices.
 *  Called when the chrome-bar record button is clicked from idle. */
async function openSetup(): Promise<void> {
  if (phase() !== "idle") return;
  setPhase("setup");
  try {
    await openPreview(micDeviceId());
    await refreshDevices();
  } catch (err) {
    if (!isAbort(err)) toast.error(`Microphone: ${errMsg(err)}`);
    setPhase("idle");
  }
}

async function changeMic(deviceId: string): Promise<void> {
  if (phase() !== "setup") return;
  setMicDeviceIdSignal(deviceId);
  try {
    await openPreview(deviceId);
  } catch (err) {
    if (!isAbort(err)) toast.error(`Microphone: ${errMsg(err)}`);
  }
}

function cancelSetup(): void {
  if (phase() !== "setup") return;
  closePreview();
  setPhase("idle");
}

/** Commit: save-picker → screen-picker → MediaRecorder over the existing
 *  preview audio stream. If anything goes wrong mid-flight, return to
 *  setup phase with the preview still live so the user can retry. */
async function startRecording(): Promise<void> {
  if (phase() !== "setup" || !preview) return;

  let sink: FileSystemWritableFileStream | null = null;
  const displayTracks: MediaStreamTrack[] = [];
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
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      systemAudio: "exclude",
    });
    displayTracks.push(...display.getTracks());

    const stream = new MediaStream([
      ...display.getVideoTracks(),
      ...preview.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(stream, { mimeType: MIME });
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) void writable.write(ev.data);
    };
    // Browser's own "stop sharing" bar ends the video track — treat it
    // like a normal stop so the file closes cleanly.
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      void stopRecording();
    });

    const startedAt = performance.now();
    const ticker = window.setInterval(
      () => setElapsedMs(performance.now() - startedAt),
      250,
    );
    // Keep `preview` alive — its analyser keeps feeding the level meter,
    // and we deliberately don't re-open a second mic stream (one device
    // handle for preview + record).
    active = {
      recorder,
      writable,
      tracks: [...displayTracks, ...preview.stream.getTracks()],
      ticker,
    };
    setElapsedMs(0);
    setPhase("recording");
    recorder.start(TIMESLICE_MS);
    toast.success("Recording started");
  } catch (err) {
    for (const t of displayTracks) t.stop();
    if (sink) await sink.close().catch(() => {});
    if (!isAbort(err)) toast.error(`Recording failed: ${errMsg(err)}`);
    // Stay in setup so the user can retry without re-granting mic.
  }
}

async function stopRecording(): Promise<void> {
  const a = active;
  if (!a) return;
  active = null;
  setPhase("idle");
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
  closePreview();
  try {
    await a.writable.close();
    toast.success("Recording saved");
  } catch (err) {
    toast.error(`Save failed: ${errMsg(err)}`);
  }
}
