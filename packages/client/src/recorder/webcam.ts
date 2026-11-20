import { Effect } from "effect";
import { createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";

export type WebcamState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "active"; stream: MediaStream };

const [devices, setDevices] = createSignal<MediaDeviceInfo[]>([]);
const [selectedId, setSelectedId] = createSignal<string>("default");
const [state, setState] = createSignal<WebcamState>({ kind: "off" });

const enabled = createMemo(() => {
  const s = state();
  return s.kind === "active" || s.kind === "loading";
});
const stream = createMemo(() => {
  const s = state();
  return s.kind === "active" ? s.stream : null;
});
const errorMessage = createMemo(() => {
  const s = state();
  return s.kind === "error" ? s.message : null;
});

export const webcam = {
  devices,
  selectedId,
  state,
  enabled,
  stream,
  errorMessage,
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function openWebcam(deviceId: string): Effect.Effect<void, unknown> {
  return Effect.suspend(() => {
    closeWebcam();
    setState({ kind: "loading" });
    return Effect.tryPromise({
      try: () =>
        navigator.mediaDevices.getUserMedia({
          video:
            deviceId === "default" ? true : { deviceId: { exact: deviceId } },
          audio: false,
        }),
      catch: (e) => e,
    });
  }).pipe(
    Effect.tap((s) =>
      Effect.sync(() => setState({ kind: "active", stream: s })),
    ),
    Effect.tapError((err) =>
      Effect.sync(() => setState({ kind: "error", message: errMsg(err) })),
    ),
    Effect.asVoid,
  );
}

const toastUnlessDismissed = <A>(
  self: Effect.Effect<A, unknown>,
): Effect.Effect<A | undefined, never> =>
  Effect.catch(self, (err) =>
    Effect.sync(() => {
      if (!isAbort(err)) toast.error(`Webcam: ${errMsg(err)}`);
      return undefined;
    }),
  );

export function closeWebcam(): void {
  const s = state();
  if (s.kind === "active") {
    for (const t of s.stream.getTracks()) t.stop();
  }
  setState({ kind: "off" });
}

export function toggleWebcam(): UiAction {
  return Effect.suspend(() => {
    if (enabled()) {
      closeWebcam();
      return Effect.void;
    }
    return openWebcam(selectedId()).pipe(toastUnlessDismissed);
  });
}

export function changeWebcam(deviceId: string): UiAction {
  return Effect.suspend(() => {
    setSelectedId(deviceId);
    if (!enabled()) return Effect.void;
    return openWebcam(deviceId).pipe(toastUnlessDismissed);
  });
}

export function setWebcamDevices(list: MediaDeviceInfo[]): void {
  setDevices(list);
}
