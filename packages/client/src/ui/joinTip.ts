/** Join the present segments of a chip's `title`/`aria-label` tooltip with a
 *  middle dot, dropping any falsy segment. */
export function joinTip(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}
