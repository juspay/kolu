/** Locators for the multi-host chrome identity chips (Kolu · Padi · Kaval).
 *
 *  Quiet-strip redesign: Padi/Kaval marks live in the per-host diagnostics
 *  popover (not on every chip). Scope Padi/Kaval to that panel once open;
 *  Kolu stays a single global mark on the identity rail.
 */

export type IdentityChipTestid =
  | "kolu-identity-chip"
  | "padi-identity-chip"
  | "kaval-identity-chip";

/** CSS selector for an identity mark. Kolu is global; Padi/Kaval are inside
 *  the open host diagnostics popover (open the active host chip first). */
export function identityChipSelector(testid: IdentityChipTestid): string {
  if (testid === "kolu-identity-chip") return `[data-testid="${testid}"]`;
  return `[data-testid="host-diagnostics-popover"] [data-testid="${testid}"]`;
}

type PageLike = {
  locator: (sel: string) => {
    click: () => Promise<void>;
    count: () => Promise<number>;
  };
  waitForSelector: (
    sel: string,
    opts?: { timeout?: number; state?: "visible" | "attached" },
  ) => Promise<unknown>;
};

/** Idempotently open the active host's diagnostics popover so Padi/Kaval
 *  marks mount. A second call is a no-op when the panel is already visible
 *  (the chip click toggles — re-clicking would close it). */
export async function openActiveHostDiagnostics(page: PageLike): Promise<void> {
  const panel = '[data-testid="host-diagnostics-popover"]';
  if ((await page.locator(panel).count()) > 0) {
    await page.waitForSelector(panel, { timeout: 5_000, state: "visible" });
    return;
  }
  const active =
    '[data-testid="host-chip-row"] [data-testid="host-chip"][data-active] [data-testid="host-select"]';
  await page.locator(active).click();
  await page.waitForSelector(panel, { timeout: 10_000, state: "visible" });
}
