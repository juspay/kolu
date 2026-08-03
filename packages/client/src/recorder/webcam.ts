/** Webcam domain: device inventory, selected camera, and the live stream.
 *
 *  State lives in one discriminated union — the invariant "enabled ⇒
 *  stream is non-null" is type-enforced rather than maintained by
 *  imperative discipline across three parallel signals. */

import { Effect } from "effect";
import { createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";

export type WebcamState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "active"; stream: MediaStream };

// HOST-SCOPING: host-INDEPENDENT by design — a browser-local device pref (the
// client machine's camera inventory/selection), not tied to any remote host.
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

/** Open the webcam. FAILS with whatever `getUserMedia` rejected, so the caller
 *  can tell a dismissed permission prompt (`AbortError`) from a real fault. */
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

/** Report a webcam failure unless it is a dismissed permission prompt — the
 *  shared recovery both verbs below end in. */
const toastUnlessDismissed = <A>(
  self: Effect.Effect<A, unknown>,
): Effect.Effect<A | void, never> =>
  Effect.catch(self, (err) =>
    Effect.sync(() => {
      if (!isAbort(err)) toast.error(`Webcam: ${errMsg(err)}`);
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
