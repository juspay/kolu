import { createHash } from "node:crypto";
import type { PwaIdentity } from "kolu-common/contract";

const THEME_COLORS = [
  "#0f766e",
  "#1d4ed8",
  "#7c3aed",
  "#be185d",
  "#b45309",
  "#15803d",
  "#be123c",
  "#047857",
  "#4338ca",
  "#a21caf",
  "#0369a1",
  "#9a3412",
] as const;

/** The app's display name — the string the browser tab title, the About dialog, and
 *  the installed PWA all read: `Kolu [<host>]`, always this kolu-server's own hostname.
 *
 *  Under ALWAYS-MAP the canvas boots on the LOCAL default (`KOLU_PADI_HOST` seeds a POOL,
 *  it no longer makes "the whole canvas become a remote host"), and *which* host a tab
 *  views is a client-side selection surfaced by the ChromeBar strip — not a server fact.
 *  So the identity no longer folds a remote host into the name (the old single-host
 *  `Kolu [<server> → <remote>]` arrow read a comma-seed-list as one remote and was wrong);
 *  it is the server's own host, byte-identical to a local single-host boot. */
export function appName(hostname: string): string {
  return `Kolu [${hostname}]`;
}

/** kolu-server's PWA identity — display {@link appName}, per-host theme color, and the
 *  raw hostname. Consumed by the `server.info` probe (browser tab title + About dialog)
 *  and the PWA manifest name. */
export function pwaIdentityForHostname(hostname: string): PwaIdentity {
  return {
    hostname,
    name: appName(hostname),
    themeColor: themeColorForHostname(hostname),
  };
}

function themeColorForHostname(hostname: string): string {
  const seed = hostname.toLowerCase();
  return THEME_COLORS[paletteIndex(seed)] ?? THEME_COLORS[0];
}

function paletteIndex(hostname: string): number {
  const digest = createHash("sha256").update(hostname).digest();
  return digest.readUInt32BE(0) % THEME_COLORS.length;
}
