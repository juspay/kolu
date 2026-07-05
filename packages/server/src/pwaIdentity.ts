import { createHash } from "node:crypto";
import type { PwaIdentity } from "kolu-common/contract";
import { remotePadiHost } from "./remotePadiBinding.ts";

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

/** The app's display name — the string the browser tab title, the About dialog,
 *  and the installed PWA all read.
 *
 *  - LOCAL binding (`remoteHost` unset): `Kolu [<host>]`, byte-identical to today —
 *    no arrow, no remote noise.
 *  - REMOTE binding (`remoteHost` set): `Kolu [<serverHost> → <remoteHost>]`. Under
 *    a remote binding the whole canvas IS the remote host, so the identity carries
 *    BOTH ends and reads unambiguously as remote — the arrow points at the host the
 *    canvas became.
 *
 *  Pure in its two inputs, so the identity test drives both arms without env. */
export function appName(
  hostname: string,
  remoteHost: string | undefined,
): string {
  return remoteHost
    ? `Kolu [${hostname} → ${remoteHost}]`
    : `Kolu [${hostname}]`;
}

/** kolu-server's PWA identity — display {@link appName}, per-host theme color, and
 *  the raw hostname. `remoteHost` defaults to the live `remotePadiHost()` knob so
 *  BOTH surfaces that build the identity carry the bound remote host with no extra
 *  wiring: the `server.info` probe (browser tab title + About dialog) and the PWA
 *  manifest name. The identity unit test passes `remoteHost` explicitly to drive the
 *  local (byte-identical) and remote arms deterministically. */
export function pwaIdentityForHostname(
  hostname: string,
  remoteHost: string | undefined = remotePadiHost(),
): PwaIdentity {
  return {
    hostname,
    name: appName(hostname, remoteHost),
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
