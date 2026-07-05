/**
 * Is the bound host's `hostInventory` reading a TRUSTWORTHY live scan, or the seeded
 * default that a not-yet-connected / degraded / version-skewed bind leaves in place?
 *
 * The re-serve seeds each mirrored cell with its schema DEFAULT
 * (`surface-nix-host/reServeSurface.ts` → `inMemoryStore(cellSpec.default)`) and only
 * replaces it once the bound padi relays a real value. So under a degraded bind — the
 * padi still warming, an ssh link that dropped, or a **version skew** where a newer
 * kolu-server binds an older padi that does not serve `hostInventory` at all (a 1.1
 * padi under a 1.2 binder is contract-refused, never relays the member) — the browser
 * reads the default `{ kavals: [], padis: [] }`. That is NOT "there are zero daemons";
 * it is "no reading arrived". Rendering it as "No running daemons discovered" would be
 * a silent empty masquerading as a definite zero (#1034).
 *
 * The intrinsic tell: a connected padi ALWAYS reports ITSELF — `discoverPadiDaemons`
 * finds the running padi and `assemblePadiInventory` marks it `active`. So a reading
 * with an active padi row is a real scan; one without is the seeded default. The dialog
 * shows an honest "unavailable" state for the latter, never "no daemons".
 */

import type { RunningPadi } from "kolu-common/surface";

/** A live reading iff the serving padi reported itself (an `active` padi row). An empty
 *  or active-less padis list is the seeded default of a bind that never delivered a real
 *  scan — so the dialog must read "unavailable", not "no daemons". */
export function hostInventoryReadingLive(
  padis: readonly RunningPadi[],
): boolean {
  return padis.some((p) => p.active);
}
