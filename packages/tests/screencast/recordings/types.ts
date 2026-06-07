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
  /** kolu-domain display tweaks applied before `drive()`. */
  display?: RecordingDisplay;
  /**
   * Logical capture viewport (CSS px; physical = ×scale). Default 1280×720
   * (→ 2560×1440). Widen/enlarge for clips that need room — the dock + an open
   * Code panel + several tiles without overlap, and more of the infinite canvas.
   * Capped by the Xvfb screen size (`X11_MAX_VIEWPORT` in hooks.ts).
   */
  viewport?: { width: number; height: number };
  /**
   * Seconds of leading load-in to trim off the front of the raw grab (app-mode
   * reload + the killAll that clears the auto-restored terminal), so the clip
   * opens on the clean empty canvas. Default 5.3.
   */
  trimStart?: number;
  /**
   * Seconds into the FINAL (trimmed) clip to sample the poster / first-paint /
   * reduced-motion still frame. Default 6 (good for an opening-on-the-canvas
   * demo). Set later for clips whose payoff is at the end (e.g. an annotated
   * dock alert) so the still shows the point, not the load-in.
   */
  posterAt?: number;
  /** Drive the flow. Uses World helpers (createTerminal/terminalRun/…). */
  drive(world: KoluWorld): Promise<void>;
}
