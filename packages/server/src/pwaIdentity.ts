import { createHash } from "node:crypto";
import type { ServerIdentity } from "kolu-common";

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

export function pwaIdentityForHostname(hostname: string): ServerIdentity {
  const name = `kolu@${hostname}`;
  return {
    hostname,
    name,
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
