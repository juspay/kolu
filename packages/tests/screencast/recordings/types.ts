import type { KoluWorld } from "../../support/world";

export interface RecordingDisplay {
  /** Collapse the right (Inspector/Code) panel so the content fills the frame. */
  hideRightPanel?: boolean;
  /** Take the left dock out of shot (keep it in to show live agent status). */
  hideDock?: boolean;
  /** Take the canvas minimap out of shot. */
  hideMinimap?: boolean;
}

export interface Recording {
  /** Stable id — doubles as the scenario name and the output file stem. */
  name: string;
  chrome: "app" | "browser";
  /** Terminal theme to pin (a name from packages/terminal-themes). */
  theme?: string;
  /** kolu-domain display tweaks applied before `drive()`. */
  display?: RecordingDisplay;
  /** Logical capture viewport (CSS px; physical = ×scale). Default 1280×720. */
  viewport?: { width: number; height: number };
  /** Seconds of leading load-in to trim off the front of the raw grab. Default 5.3. */
  trimStart?: number;
  /** Seconds into the final clip to sample the poster still frame. Default 6. */
  posterAt?: number;
  /** Drive the flow. Uses World helpers (createTerminal/terminalRun/…). */
  drive(world: KoluWorld): Promise<void>;
}
