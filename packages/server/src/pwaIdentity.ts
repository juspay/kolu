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
  return (
    THEME_COLORS[hashHostname(seed) % THEME_COLORS.length] ?? THEME_COLORS[0]
  );
}

function hashHostname(hostname: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < hostname.length; i++) {
    hash ^= hostname.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
