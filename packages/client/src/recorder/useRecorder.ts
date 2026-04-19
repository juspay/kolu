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
 *  FSA). `isRecordingSupported()` hides entry points elsewhere. */

import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import fixWebmDuration from "fix-webm-duration";

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

type Phase = "idle" | "setup" | "recording" | "paused";

const [phase, setPhase] = createSignal<Phase>("idle");
const [elapsedMs, setElapsedMs] = createSignal(0);
const [micDevices, setMicDevices] = createSignal<MediaDeviceInfo[]>([]);
const [micDeviceId, setMicDeviceIdSignal] = createSignal<string>("default");
const [micLevel, setMicLevel] = createSignal(0);
const [micError, setMicError] = createSignal<string | null>(null);

const [webcamEnabled, setWebcamEnabledSignal] = createSignal(false);
const [webcamStream, setWebcamStream] = createSignal<MediaStream | null>(null);
const [webcamDevices, setWebcamDevices] = createSignal<MediaDeviceInfo[]>([]);
const [webcamDeviceId, setWebcamDeviceIdSignal] =
  createSignal<string>("default");
const [webcamError, setWebcamError] = createSignal<string | null>(null);

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
  /** User-picked save destination. Kept for the post-stop read-back +
   *  duration patch cycle. */
  handle: FileSystemFileHandle;
  /** Streaming sink for WebM chunks during recording — keeps memory
   *  flat regardless of duration. At stop, we close this, read the
   *  completed file back via `handle.getFile()`, patch the WebM
   *  SegmentInfo.Duration header that Chrome's MediaRecorder omits
   *  in streaming mode, and overwrite with a fresh writable. */
  writable: FileSystemWritableFileStream;
  tracks: MediaStreamTrack[];
  ticker: number;
  /** Anchor used by the ticker: `elapsed = performance.now() - anchor`.
   *  Mutated on resume to subtract paused duration. */
  anchor: number;
  /** Snapshot taken at pause; restored on resume by rewinding `anchor`. */
  pauseElapsed: number | null;
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
    webcamEnabled,
    webcamStream,
    webcamDevices,
    webcamDeviceId,
    webcamError,
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

// ── Mic preview ─────────────────────────────────────────────────────────

/** Open a mic stream for the given deviceId and attach an AnalyserNode.
 *  Runs an rAF loop that publishes the current RMS level to `micLevel`.
 *  Re-entrant: closes any existing preview first. */
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
      const next = Math.min(1, Math.pow(rms, 0.5) * 2);
      if (Math.abs(next - micLevel()) > 0.01) setMicLevel(next);
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

// ── Webcam ──────────────────────────────────────────────────────────────

/** Open a webcam stream on the given deviceId. Re-entrant. */
async function openWebcam(deviceId: string): Promise<void> {
  closeWebcam();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
      audio: false,
    });
    setWebcamStream(stream);
    setWebcamError(null);
  } catch (err) {
    setWebcamError(errMsg(err));
    throw err;
  }
}

function closeWebcam(): void {
  const s = webcamStream();
  if (!s) return;
  for (const t of s.getTracks()) t.stop();
  setWebcamStream(null);
}

async function toggleWebcam(): Promise<void> {
  if (webcamEnabled()) {
    setWebcamEnabledSignal(false);
    closeWebcam();
    return;
  }
  try {
    await openWebcam(webcamDeviceId());
    await refreshDevices();
    setWebcamEnabledSignal(true);
  } catch (err) {
    if (!isAbort(err)) toast.error(`Webcam: ${errMsg(err)}`);
    setWebcamEnabledSignal(false);
  }
}

async function changeWebcam(deviceId: string): Promise<void> {
  setWebcamDeviceIdSignal(deviceId);
  if (!webcamEnabled()) return;
  try {
    await openWebcam(deviceId);
  } catch (err) {
    if (!isAbort(err)) toast.error(`Webcam: ${errMsg(err)}`);
  }
}

// ── Device enumeration ──────────────────────────────────────────────────

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

// ── Setup phase ─────────────────────────────────────────────────────────

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
  closeWebcam();
  setWebcamEnabledSignal(false);
  setPhase("idle");
}

// ── Recording phase ─────────────────────────────────────────────────────

/** Commit: save-picker → screen-picker → MediaRecorder over the existing
 *  preview audio stream. If anything goes wrong mid-flight, return to
 *  setup phase with preview + webcam still live so the user can retry. */
async function startRecording(): Promise<void> {
  if (phase() !== "setup" || !preview) return;

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
      ...preview.stream.getAudioTracks(),
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

    const anchor = performance.now();
    const ticker = window.setInterval(tickElapsed, 250);
    active = {
      recorder,
      handle,
      writable,
      tracks: [...displayTracks, ...preview.stream.getTracks()],
      ticker,
      anchor,
      pauseElapsed: null,
    };
    openedWritable = null; // ownership transferred to `active`
    setElapsedMs(0);
    setPhase("recording");
    recorder.start(TIMESLICE_MS);
    toast.success("Recording started");
  } catch (err) {
    for (const t of displayTracks) t.stop();
    if (openedWritable) await openedWritable.close().catch(() => {});
    if (!isAbort(err)) toast.error(`Recording failed: ${errMsg(err)}`);
    // Stay in setup so the user can retry without re-granting mic/webcam.
  }
}

function togglePause(): void {
  const a = active;
  if (!a) return;
  if (phase() === "recording") {
    // Belt-and-suspenders pause:
    //  1. MediaRecorder.pause() — spec-correct, stops encoding entirely.
    //  2. Disable every source track. If a browser in some build emits
    //     frames anyway during `paused` state, the content is at least
    //     black + silent. Re-enabled on resume before the recorder resumes
    //     so the first post-pause chunk has live content.
    try {
      a.recorder.pause();
    } catch (err) {
      toast.error(`Pause failed: ${errMsg(err)}`);
      return;
    }
    for (const t of a.tracks) t.enabled = false;
    clearInterval(a.ticker);
    a.pauseElapsed = performance.now() - a.anchor;
    setElapsedMs(a.pauseElapsed);
    setPhase("paused");
  } else if (phase() === "paused") {
    for (const t of a.tracks) t.enabled = true;
    try {
      a.recorder.resume();
    } catch (err) {
      toast.error(`Resume failed: ${errMsg(err)}`);
      return;
    }
    // Rewind the anchor so `now - anchor` resumes from the paused snapshot.
    if (a.pauseElapsed !== null) {
      a.anchor = performance.now() - a.pauseElapsed;
      a.pauseElapsed = null;
    }
    a.ticker = window.setInterval(tickElapsed, 250);
    setPhase("recording");
  }
}

/** Ticker body — guarded against same-second no-ops so downstream
 *  memos don't re-flush 4× per displayed tick. */
function tickElapsed(): void {
  if (!active) return;
  const next = performance.now() - active.anchor;
  if (Math.floor(next / 1000) !== Math.floor(elapsedMs() / 1000)) {
    setElapsedMs(next);
  }
}

async function stopRecording(): Promise<void> {
  const a = active;
  if (!a) return;
  active = null;
  setPhase("idle");
  clearInterval(a.ticker);
  setElapsedMs(0);

  const durationMs = a.pauseElapsed ?? performance.now() - a.anchor;

  // Race-safe recorder shutdown. If `recorder.state` is already
  // "inactive" (e.g. display track ended fired our handler which
  // re-entered stopRecording after MediaRecorder already auto-stopped),
  // calling stop() throws AND the stop event has already fired — so a
  // naive `await new Promise(...)` with an addEventListener hangs
  // forever, blocking the rest of cleanup (`closePreview` et al) and
  // leaking the mic stream into the next session.
  if (a.recorder.state !== "inactive") {
    await new Promise<void>((resolve) => {
      a.recorder.addEventListener("stop", () => resolve(), { once: true });
      try {
        a.recorder.stop();
      } catch {
        resolve();
      }
    });
  }
  for (const t of a.tracks) t.stop();
  closePreview();
  closeWebcam();
  setWebcamEnabledSignal(false);

  try {
    // Close the streaming writable so every pending `write()` queued
    // from `ondataavailable` is flushed to disk before we read the
    // file back for the duration-fix pass.
    await a.writable.close();

    // Chrome's MediaRecorder streams WebM without a SegmentInfo.Duration
    // header, so players show an arbitrary length (often 0:01). Read
    // the just-flushed file back into memory, patch the header, and
    // overwrite. Peak memory is the full file briefly (unavoidable —
    // `fix-webm-duration` is not a streaming patcher); during recording,
    // memory stayed flat.
    const raw = await a.handle.getFile();
    let out: Blob = raw;
    try {
      out = await fixWebmDuration(raw, durationMs);
    } catch (err) {
      toast.warning(`Duration patch failed: ${errMsg(err)}`);
    }
    // Fresh `createWritable()` defaults to truncating the file, so the
    // patched blob replaces the streamed bytes wholesale.
    const patched = await a.handle.createWritable();
    await patched.write(out);
    await patched.close();

    toast.success(`Recording saved · ${formatElapsed(durationMs)}`, {
      description: a.handle.name,
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
