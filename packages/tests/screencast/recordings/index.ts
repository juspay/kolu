import { recording as heroDemo } from "./hero-demo.recording";
import type { Recording } from "./types";

export const recordings: Record<string, Recording> = {
  [heroDemo.name]: heroDemo,
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
