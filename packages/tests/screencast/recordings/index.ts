// Registry of all recordings, keyed by name (= scenario name = output stem).
// Add a recording: drop a `<name>.recording.ts` file and list it here.
import type { Recording } from "./types";
import { recording as codeReviewDemo } from "./code-review-demo.recording";
import { recording as dockAlertDemo } from "./dock-alert-demo.recording";
import { recording as newTerminalDemo } from "./new-terminal-demo.recording";

export const recordings: Record<string, Recording> = {
  [newTerminalDemo.name]: newTerminalDemo,
  [dockAlertDemo.name]: dockAlertDemo,
  [codeReviewDemo.name]: codeReviewDemo,
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
