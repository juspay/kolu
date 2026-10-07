/**
 * How kolu writes a byte count — ONE formatter, with the units picked once:
 * BINARY (KiB · MiB · GiB, powers of 1024), the units Nix reports a closure in,
 * so a download's "1.1 GiB" and `nix path-info -Sh` agree. Every byte figure a
 * person reads in kolu (process memory, snapshot sizes, an agents download)
 * goes through here. Zero dependencies; safe in the browser and in a daemon.
 */

export const KIB = 1024;
export const MIB = 1024 * KIB;
export const GIB = 1024 * MIB;

/** "512 B", "23 KiB", "142 MiB", "1.1 GiB" — the unit picked for the size:
 *  whole KiB and MiB, one decimal of GiB. */
export function formatBytes(bytes: number): string {
  if (bytes < KIB) return `${Math.round(bytes)} B`;
  if (bytes < MIB) return `${Math.round(bytes / KIB)} KiB`;
  if (bytes < GIB) return `${Math.round(bytes / MIB)} MiB`;
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

/** A figure held in MiB at a fixed precision — "150.0 MiB" (1 decimal) or
 *  "142 MiB" (whole) — for readouts that should not change unit as they move. */
export function formatMiB(bytes: number, decimals: 0 | 1): string {
  const mib = bytes / MIB;
  return `${decimals === 0 ? Math.round(mib) : (Math.round(mib * 10) / 10).toFixed(1)} MiB`;
}
