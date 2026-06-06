// A Recording is kolu DOMAIN: it names a clip, declares its display properties,
// and drives the flow with the existing World helpers. It depends on the
// agnostic capture engine (../engine.ts) — never the reverse.
import type { KoluWorld } from "../../support/world";

export interface RecordingDisplay {
  /** Collapse the right (Inspector/Code) panel so the content fills the frame. */
  hideRightPanel?: boolean;
  /**
   * Hide the dock + canvas minimap for a clean, focused canvas — a marketing
   * composition choice (the surfaces still exist; they're just out of shot).
   */
  cleanCanvas?: boolean;
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
  /** One-line caption used by the embed + docs. */
  caption: string;
  /** kolu-domain display tweaks applied before `drive()`. */
  display?: RecordingDisplay;
  /** Drive the flow. Uses World helpers (createTerminal/terminalRun/…). */
  drive(world: KoluWorld): Promise<void>;
}
