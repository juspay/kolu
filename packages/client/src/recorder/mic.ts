import { Effect } from "effect";
import { createMemo, createSignal } from "solid-js";

export type MicState =
  | { kind: "off" }
  | { kind: "error"; message: string }
  | { kind: "live" };

const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([]);
const [selectedId, setSelectedId] = createSignal<string>("default");
const [state, setState] = createSignal<MicState>({ kind: "off" });
const [level, setLevel] = createSignal(0);

const errorMessage = createMemo(() => {
  const s = state();
  return s.kind === "error" ? s.message : null;
});

export const mic = {
  devices,
  selectedId,
  state,
  level,
  errorMessage,
};

interface Preview {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  raf: number;
}
let preview: Preview | null = null;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function openMicPreviewFromGesture(
  deviceId: string,
): Effect.Effect<void, unknown> {
  return Effect.suspend(() => {
    closeMicPreview();
    return Effect.tryPromise({
      try: () =>
        navigator.mediaDevices.getUserMedia({
          audio:
            deviceId === "default" ? true : { deviceId: { exact: deviceId } },
          video: false,
        }),
      catch: (e) => e,
    });
  }).pipe(
    Effect.tap((stream) =>
      Effect.sync(() => {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
        const tick = () => {
          if (!preview) return;
          preview.analyser.getFloatTimeDomainData(preview.buf);
          let sum = 0;
          for (const v of preview.buf) {
            sum += v * v;
          }
          const rms = Math.sqrt(sum / preview.buf.length);
          const next = Math.min(1, rms ** 0.5 * 2);
          if (Math.abs(next - level()) > 0.01) setLevel(next);
          preview.raf = requestAnimationFrame(tick);
        };
        preview = {
          stream,
          ctx,
          source,
          analyser,
          buf,
          raf: requestAnimationFrame(tick),
        };
        setState({ kind: "live" });
      }),
    ),
    Effect.tapError((err) =>
      Effect.sync(() => setState({ kind: "error", message: errMsg(err) })),
    ),
    Effect.asVoid,
  );
}

export function closeMicPreview(): void {
  if (!preview) return;
  cancelAnimationFrame(preview.raf);
  preview.source.disconnect();
  void preview.ctx.close();
  for (const t of preview.stream.getTracks()) t.stop();
  preview = null;
  setState({ kind: "off" });
  setLevel(0);
}

export function micPreviewStream(): MediaStream | null {
  return preview?.stream ?? null;
}

export function setMicSelectedId(id: string): void {
  setSelectedId(id);
}

export function setMicDevices(list: MediaDeviceInfo[]): void {
  setDevices(list);
}
