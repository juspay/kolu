import { compactDelta, dualOf } from "@kolu/terminal-vocab/duration";
import { DASH } from "kolu-common/surface";

/** A compact elapsed readout for a LIVE, seconds-granularity timer — `"45s"`
 *  under a minute, `"2m 3s"` above. Hours and above pair with the ladder's own
 *  `sub` unit, not with seconds-within-the-minute. */
export function formatElapsedShort(ms: number): string {
  const d = compactDelta(ms);
  if (d.kind === "delta" && d.unit === "m") {
    return `${d.value}m ${Math.floor(ms / 1000) % 60}s`;
  }
  return dualOf(d);
}

/** How long ago an ISO stamp was, in the compact readout above. A future or
 *  unparseable stamp renders as the dash. */
export function elapsedSince(iso: string, now: number): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? DASH : formatElapsedShort(now - at);
}
