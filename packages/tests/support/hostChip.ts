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
    getAttribute: (name: string) => Promise<string | null>;
  };
  waitForSelector: (
    sel: string,
    opts?: { timeout?: number; state?: "visible" | "attached" },
  ) => Promise<unknown>;
};

/** Idempotently open the ACTIVE host's diagnostics popover. Scopes the
 *  already-open check to that host's `data-host` so a panel for a different
 *  host does not short-circuit the open. */
export async function openActiveHostDiagnostics(page: PageLike): Promise<void> {
  const activeChip =
    '[data-testid="host-chip-row"] [data-testid="host-chip"][data-active]';
  const activeKey = await page.locator(activeChip).getAttribute("data-host");
  if (!activeKey) {
    throw new Error(
      "openActiveHostDiagnostics: no active host chip (data-host) found",
    );
  }
  // Host keys are encodeHostKey strings (no quotes); attribute match is exact.
  const panel = `[data-testid="host-diagnostics-popover"][data-host="${activeKey}"]`;
  if ((await page.locator(panel).count()) > 0) {
    await page.waitForSelector(panel, { timeout: 5_000, state: "visible" });
    return;
  }
  await page.locator(`${activeChip} [data-testid="host-select"]`).click();
  await page.waitForSelector(panel, { timeout: 10_000, state: "visible" });
}
