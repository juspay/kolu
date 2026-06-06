// A Recording is kolu DOMAIN: it names a clip, declares its display properties,
// and drives the flow with the existing World helpers. It depends on the
// agnostic capture engine (../engine.ts) — never the reverse.
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
  /**
   * "browser" launches with real Chrome chrome (tabs + address bar) — right for
   * showing the *install* affordance in context. "app" launches the frameless
   * `--app=` window an installed PWA uses — right for the product demo.
   */
  chrome: "app" | "browser";
  /** Terminal theme to pin (a name from packages/terminal-themes), so clips
   *  look consistent — e.g. "Vaughn". Applied to terminals created via the
   *  `newTerminal` helper. */
  theme?: string;
  /** One-line caption used by the embed + docs. */
  caption: string;
  /** kolu-domain display tweaks applied before `drive()`. */
  display?: RecordingDisplay;
  /** Drive the flow. Uses World helpers (createTerminal/terminalRun/…). */
  drive(world: KoluWorld): Promise<void>;
}
