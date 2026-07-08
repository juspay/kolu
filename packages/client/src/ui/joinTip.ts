/** Join the present segments of a chip's `title`/`aria-label` tooltip with a
 *  middle dot, dropping any falsy segment. Shared by the Kolu chip
 *  (`IdentityRail`) and the per-host Padi/Kaval sub-chips (`HostDaemonChips`) so
 *  the "full detail lives in the tooltip" copy can't fork between them. */
export function joinTip(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}
