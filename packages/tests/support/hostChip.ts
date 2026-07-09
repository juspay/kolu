/** Locators for the multi-host chrome identity chips (Kolu · Padi · Kaval).
 *
 *  Centralized so the host-chip DOM shape lives in ONE place: Padi/Kaval marks
 *  render on every host chip, so a bare `[data-testid="padi-identity-chip"]`
 *  would match N chips. Scope to the ACTIVE chip (`[data-active]`). Kolu is a
 *  single global mark, not host-scoped, so it needs no chip scope. */

export type IdentityChipTestid =
  | "kolu-identity-chip"
  | "padi-identity-chip"
  | "kaval-identity-chip";

/** CSS selector for an identity mark, scoped to the active host chip for the
 *  per-host (Padi/Kaval) marks. */
export function identityChipSelector(testid: IdentityChipTestid): string {
  if (testid === "kolu-identity-chip") return `[data-testid="${testid}"]`;
  return `[data-testid="host-chip"][data-active] [data-testid="${testid}"]`;
}
