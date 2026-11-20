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
