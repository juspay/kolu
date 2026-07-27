/** The browse tree's inventory merge — pure, so the three rules that have each
 *  already caused a bug are pinned by a table test rather than argued in a
 *  comment beside the reactive code.
 *
 *  The rules, and the defect each one closes:
 *
 *  1. **Absent is not empty.** While the tracked listing is in flight (a repo or
 *     host switch, first paint) there is no authority to subtract the overlay
 *     against. Reading that absence as "nothing is tracked" admitted the overlay
 *     unfiltered and painted the tree as nothing but dimmed `node_modules/` rows
 *     until `fs.listAll` landed. No authority ⇒ no partition, which makes rule 2
 *     true at EVERY instant rather than only at settled ones.
 *  2. **Tracked wins.** The two listings are separate `git ls-files` reads taken
 *     at different instants against a live working tree, so a file ignored
 *     between them (an agent editing `.gitignore`) can appear in BOTH. Handing
 *     Pierre a duplicate `add` desyncs its wrapper's `appliedPaths` bookkeeping
 *     permanently, so the overlap is dropped from the overlay — the tracked
 *     listing is the authority on what the tree is FOR.
 *  3. **Readiness covers both sources, but only the ones being consulted.** The
 *     overlay leg counts only while the toggle is on, because an idle
 *     `createPolledQuery` stays `pending` forever — folding an idle query's
 *     readiness in would wedge the tree permanently pending with the toggle off. */

export interface BrowseInventory {
  /** Everything the tree renders: tracked entries, then the overlay. */
  paths: string[];
  /** The overlay alone — the rows to dim. A subset of `paths`. */
  ignored: string[];
  /** True while any consulted source has yet to deliver. */
  pending: boolean;
}

export function mergeBrowseInventory(
  tracked: readonly string[] | undefined,
  ignored: readonly string[] | undefined,
  readiness: {
    trackedPending: boolean;
    ignoredPending: boolean;
    showIgnored: boolean;
  },
): BrowseInventory {
  const pending =
    readiness.trackedPending ||
    (readiness.showIgnored && readiness.ignoredPending);
  // Rule 1 — no tracked authority, no partition, so no overlay either.
  if (!tracked) return { paths: [], ignored: [], pending };
  // Rule 2 — the overlap belongs to the tracked listing.
  const seen = new Set(tracked);
  const overlay = (ignored ?? []).filter((p) => !seen.has(p));
  return { paths: [...tracked, ...overlay], ignored: overlay, pending };
}
