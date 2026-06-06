// Registry of all recordings, keyed by name (= scenario name = output stem).
// Add a recording: drop a `<name>.recording.ts` file and list it here.
import type { Recording } from "./types";
import { recording as newTerminalDemo } from "./new-terminal-demo.recording";
import { recording as pwaInstall } from "./pwa-install.recording";

export const recordings: Record<string, Recording> = {
  [pwaInstall.name]: pwaInstall,
  [newTerminalDemo.name]: newTerminalDemo,
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
