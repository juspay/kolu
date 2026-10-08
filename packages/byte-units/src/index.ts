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
 *  whole KiB and MiB, one decimal of GiB. The unit is picked on the ROUNDED
 *  figure, so a count just under a boundary reads "1 KiB", never "1024 B". */
export function formatBytes(bytes: number): string {
  if (Math.round(bytes) < KIB) return `${Math.round(bytes)} B`;
  if (Math.round(bytes / KIB) < KIB) return `${Math.round(bytes / KIB)} KiB`;
  if (Math.round(bytes / MIB) < KIB) return `${Math.round(bytes / MIB)} MiB`;
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

/** A byte count in MiB, rounded to whole MiB or to a tenth — the ONE rounding
 *  behind {@link formatMiB}, for a caller that needs the number itself (a dedup
 *  on the figure a readout shows, a machine-readable snapshot). */
export function mibOf(bytes: number, decimals: 0 | 1): number {
  const scale = decimals === 0 ? 1 : 10;
  return Math.round((bytes / MIB) * scale) / scale;
}

/** A figure held in MiB at a fixed precision — "150.0 MiB" (1 decimal) or
 *  "142 MiB" (whole) — for readouts that should not change unit as they move. */
export function formatMiB(bytes: number, decimals: 0 | 1): string {
  return `${mibOf(bytes, decimals).toFixed(decimals)} MiB`;
}
