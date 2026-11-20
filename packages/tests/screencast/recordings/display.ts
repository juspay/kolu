import type { KoluWorld } from "../../support/world";
import type { RecordingDisplay } from "./types";

export async function applyDisplay(
  world: KoluWorld,
  display?: RecordingDisplay,
): Promise<void> {
  if (!display) return;

  if (display.hideRightPanel) {
    const btn = world.page.locator('button[aria-label="Collapse panel"]');
    await btn
      .click({ timeout: 2000 })
      .then(() => world.waitForFrame())
      .catch(() => undefined);
  }

  const hidden: string[] = [];
  if (display.hideDock) hidden.push('[data-testid="dock"]');
  if (display.hideMinimap) hidden.push('[data-testid="canvas-minimap"]');
  if (hidden.length) {
    await world.page
      .addStyleTag({ content: `${hidden.join(",")}{display:none !important}` })
      .catch(() => undefined);
    await world.waitForFrame();
  }
}
