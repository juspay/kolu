/** A redeploy, as a person's browser lives through it.
 *
 *  `restartKoluServer` replaces kolu-server and padi and keeps kaval, so the
 *  terminals survive under the ids they had. It starts the new server on a NEW
 *  PORT, though, and a browser keys its storage by origin: the page that loads
 *  afterwards would find none of what the old page saved. A real redeploy
 *  keeps the address, so the tab that reloads it keeps its storage. This
 *  carries the old page's `localStorage` to the new origin, once, before any
 *  of kolu's code runs there — the browser's side of a redeploy, and nothing
 *  of kolu's. */

import { restartKoluServer } from "./hooks.ts";
import { type KoluWorld, POLL_TIMEOUT } from "./world.ts";

export async function redeployUnderThisPage(
  world: KoluWorld,
  whileDown?: () => void,
): Promise<void> {
  const saved = await world.page.evaluate(() => Object.entries(localStorage));
  const url = await restartKoluServer(whileDown);
  await world.page.addInitScript(
    ({ origin, entries }) => {
      // Once per origin: a later reload must see what the app wrote since,
      // not this snapshot again.
      if (location.origin !== origin) return;
      if (sessionStorage.getItem("kolu-e2e-storage-carried") !== null) return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      sessionStorage.setItem("kolu-e2e-storage-carried", "");
    },
    { origin: new URL(url).origin, entries: saved },
  );
  await world.page.goto(url);
  await world.page
    .locator(
      '[data-visible] .xterm-screen, [data-testid="dormant-tile-body"], [data-testid="empty-state"]',
    )
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}
