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

/** Open the active host's diagnostics popover so Padi/Kaval marks mount. */
export async function openActiveHostDiagnostics(page: {
  locator: (sel: string) => {
    click: () => Promise<void>;
    hover: () => Promise<void>;
  };
  waitForSelector: (
    sel: string,
    opts?: { timeout?: number },
  ) => Promise<unknown>;
}): Promise<void> {
  const active = page.locator(
    '[data-testid="host-chip-row"] [data-testid="host-chip"][data-active] [data-testid="host-select"]',
  );
  await active.click();
  await page.waitForSelector('[data-testid="host-diagnostics-popover"]', {
    timeout: 10_000,
  });
}
