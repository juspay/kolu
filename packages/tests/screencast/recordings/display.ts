// Enact a recording's declarative display properties via kolu's own controls.
// This is the single place that knows HOW "hide the right panel" / "collapse
// the dock" map onto kolu UI — recordings only declare the intent.
import type { KoluWorld } from "../../support/world";
import type { RecordingDisplay } from "./types";

export async function applyDisplay(
  world: KoluWorld,
  display?: RecordingDisplay,
): Promise<void> {
  if (!display) return;

  if (display.hideRightPanel) {
    // RightPanel chrome-bar collapse button (shrinks the panel to ~0 width).
    // Best-effort: the panel may already be collapsed (default pref) or mid-
    // animation — never let a display tweak fail the recording.
    const btn = world.page.locator('button[aria-label="Collapse panel"]');
    await btn
      .click({ timeout: 2000 })
      .then(() => world.waitForFrame())
      .catch(() => undefined);
  }

  if (display.cleanCanvas) {
    // Take the dock + minimap out of shot. Injected CSS (not a code change to
    // the app) — a per-recording composition choice; the surfaces still exist.
    await world.page
      .addStyleTag({
        content:
          '[data-testid="dock"],[data-testid="canvas-minimap"]{display:none !important}',
      })
      .catch(() => undefined);
    await world.waitForFrame();
  }
}
