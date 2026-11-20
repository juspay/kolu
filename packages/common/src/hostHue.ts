export const HOST_HUE_PALETTE = [
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

function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The deterministic identity hue (a palette hex) for a host seed. Case-folded
 *  so `Zest` and `zest` land on the same colour. */
export function hostHueFor(seed: string): string {
  const index = fnv1a(seed.toLowerCase()) % HOST_HUE_PALETTE.length;
  return HOST_HUE_PALETTE[index] ?? HOST_HUE_PALETTE[0];
}
