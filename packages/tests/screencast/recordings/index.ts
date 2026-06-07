// Registry of all recordings, keyed by name (= scenario name = output stem).
// Add a recording: drop a `<name>.recording.ts` file and list it here.
import type { Recording } from "./types";
import { recording as dockAlertDemo } from "./dock-alert-demo.recording";

export const recordings: Record<string, Recording> = {
  [dockAlertDemo.name]: dockAlertDemo,
};

export function getRecording(name: string): Recording {
  const r = recordings[name];
  if (!r) {
    throw new Error(
      `Unknown recording "${name}". Known: ${Object.keys(recordings).join(", ")}`,
    );
  }
  return r;
}

export type { Recording, RecordingDisplay } from "./types";
