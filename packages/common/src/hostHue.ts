/** A deterministic seed→palette leaf — one hex per seed string — shared by the
 *  TWO surfaces that colour a host, which each key it DIFFERENTLY:
 *
 *    · the server's PWA `theme-color` (the window/chrome tint for its own host —
 *      `pwaIdentity.ts`) seeds the RAW machine hostname, so each machine's
 *      installed PWA window stays visually distinct, and
 *    · the client's host tabs (each chip's accent — `hostChipTone.ts` →
 *      `HostSelectorStrip`) seed the canonical `encodeHostKey`, where the local
 *      host is always the literal `local`.
 *
 *  This is the shared palette + index function only — NOT a shared host→seed
 *  keying: the two surfaces disagree on what canonical string names a host, so a
 *  given host can land on different palette entries across them. The hash is a
 *  pure, sync FNV-1a so it runs identically in Node and the browser (no
 *  `node:crypto`, which the client can't call synchronously at render time). */

/** The fixed identity palette — twelve mid-saturation hues that read on both the
 *  light and dark chrome surface. Order is load-bearing: it's the index space
 *  {@link hostHueFor} maps into, so appending is safe but reordering re-colours
 *  every host. */
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

/** FNV-1a 32-bit over the seed's UTF-16 code units — a pure, dependency-free
 *  string hash. `>>> 0` keeps every step in unsigned 32-bit space so Node and
 *  the browser agree bit-for-bit. */
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
  // Non-null: `index` is always a valid palette offset (`% length`), but the
  // tuple index signature is `string | undefined`; the fallback is unreachable.
  return HOST_HUE_PALETTE[index] ?? HOST_HUE_PALETTE[0];
}
