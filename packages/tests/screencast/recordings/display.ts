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

  if (display.collapseDock) {
    // No dedicated dock-collapse control today; left as a hook for when one
    // lands so recordings can already declare the intent.
  }
}
