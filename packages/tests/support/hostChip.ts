/** Locators for the multi-host chrome identity chips (Kolu · Padi · Kaval).
 *
 *  Quiet strip: full Padi/Kaval marks live in the diagnostics popover. Open it
 *  via the connection-status pip (`host-diagnostics-open`). Local identity is
 *  a Home glyph; remotes show hostname. Kolu stays a single global mark on the
 *  identity rail.
 */

export type IdentityChipTestid =
  | "kolu-identity-chip"
  | "padi-identity-chip"
  | "kaval-identity-chip";

/** CSS selector for an identity mark. Kolu is global; Padi/Kaval are inside
 *  the open host diagnostics popover. */
export function identityChipSelector(testid: IdentityChipTestid): string {
  if (testid === "kolu-identity-chip") return `[data-testid="${testid}"]`;
  return `[data-testid="host-diagnostics-popover"] [data-testid="${testid}"]`;
}

type LocatorLike = {
  click: () => Promise<void>;
  count: () => Promise<number>;
  getAttribute: (name: string) => Promise<string | null>;
};

type PageLike = {
  locator: (sel: string) => LocatorLike;
  waitForSelector: (
    sel: string,
    opts?: { timeout?: number; state?: "visible" | "attached" },
  ) => Promise<unknown>;
};

const PANEL = '[data-testid="host-diagnostics-popover"]';
const ACTIVE_CHIP =
  '[data-testid="host-chip-row"] [data-testid="host-chip"][data-active]';
const ACTIVE_STATUS_PIP = `${ACTIVE_CHIP} [data-testid="host-diagnostics-open"]`;

/** Idempotently open the ACTIVE host's diagnostics popover via its status pip.
 *  Every host (including local healthy) has a pip. */
export async function openActiveHostDiagnostics(page: PageLike): Promise<void> {
  const activeKey = await page.locator(ACTIVE_CHIP).getAttribute("data-host");
  if (!activeKey) {
    throw new Error(
      "openActiveHostDiagnostics: no active host chip (data-host) found",
    );
  }

  const panelHost =
    (await page.locator(PANEL).count()) > 0
      ? await page.locator(PANEL).getAttribute("data-host")
      : null;

  if (panelHost === activeKey) {
    await page.waitForSelector(PANEL, { timeout: 5_000, state: "visible" });
    return;
  }

  const pipCount = await page.locator(ACTIVE_STATUS_PIP).count();
  if (pipCount === 0) {
    throw new Error("openActiveHostDiagnostics: active chip has no status pip");
  }

  await page.locator(ACTIVE_STATUS_PIP).click();
  await page.waitForSelector(PANEL, { timeout: 10_000, state: "visible" });

  const openedHost = await page.locator(PANEL).getAttribute("data-host");
  if (openedHost !== activeKey) {
    throw new Error(
      `openActiveHostDiagnostics: expected panel for ${JSON.stringify(activeKey)}, got ${JSON.stringify(openedHost)}`,
    );
  }
}
