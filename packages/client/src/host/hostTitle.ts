/**
 * The browser-tab / document title — tab IDENTIFICATION (drishti's own pattern): which
 * host this tab is viewing. Plain **"Kolu"** on the LOCAL default (you're on your own
 * machine — no qualifier), **"Kolu [<host>]"** when a remote is the ACTIVE host. Pure in
 * its input; the reactive tab title binds it to the `activeHost` signal (see
 * `useServerIdentity`), so it updates the instant you switch hosts on the ChromeBar strip.
 * NEVER the raw `KOLU_PADI_HOST` env string — that's a config dump (a comma-seed list),
 * not an identity (the F5 fix: the old server-side identity folded the env and, under
 * always-map, read a seed LIST as one remote).
 */

import type { HostKey } from "kolu-common/hostKey";

/** `"Kolu"` for the local default, `"Kolu [<host>]"` for an active remote. */
export function hostTitle(active: HostKey): string {
  return active.kind === "local" ? "Kolu" : `Kolu [${active.target}]`;
}
