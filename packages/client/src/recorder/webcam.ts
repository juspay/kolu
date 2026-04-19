/** Webcam domain: device inventory, selected camera, and the live stream.
 *
 *  State lives in one discriminated union — the invariant "enabled ⇒
 *  stream is non-null" is type-enforced rather than maintained by
 *  imperative discipline across three parallel signals. */

import { createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";

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

export async function openWebcam(deviceId: string): Promise<void> {
  closeWebcam();
  setState({ kind: "loading" });
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
      audio: false,
    });
    setState({ kind: "active", stream: s });
  } catch (err) {
    setState({ kind: "error", message: errMsg(err) });
    throw err;
  }
}

export function closeWebcam(): void {
  const s = state();
  if (s.kind === "active") {
    for (const t of s.stream.getTracks()) t.stop();
  }
  setState({ kind: "off" });
}

export async function toggleWebcam(): Promise<void> {
  if (enabled()) {
    closeWebcam();
    return;
  }
  try {
    await openWebcam(selectedId());
  } catch (err) {
    if (!isAbort(err)) toast.error(`Webcam: ${errMsg(err)}`);
  }
}

export async function changeWebcam(deviceId: string): Promise<void> {
  setSelectedId(deviceId);
  if (!enabled()) return;
  try {
    await openWebcam(deviceId);
  } catch (err) {
    if (!isAbort(err)) toast.error(`Webcam: ${errMsg(err)}`);
  }
}

export function setWebcamDevices(list: MediaDeviceInfo[]): void {
  setDevices(list);
}
