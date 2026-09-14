/** User arrangement of the dock — names, not ids, so the order survives
 *  terminal recreation: repos are `info.key.group`, cluster labels are
 *  `info.key.label`. A name that no longer exists is SKIPPED at merge time
 *  (its slot is NOT returned to the structural order — the merge keeps the
 *  stored sequence of what remains); a name never seen appends at the end.
 *
 *  This leaf is the VOCABULARY only: no imports, no persistence, no SolidJS.
 *  The per-host STORED face lives one sibling up in the same directory at
 *  `dockOrderPref.ts` — the same triple `activityWindow.ts` /
 *  `activityWindowFilter.ts` established: the least-volatile vocab leaf has NO
 *  back-edge into the host-scope owner (`createHostPrefs` imports only this
 *  leaf), so layering stays downward and no import cycle can form.
 *
 *  Two known edges of keying by names, both intended (carried where the
 *  persisted reader lives, `hostScope/createHostPrefs.ts`):
 *    (a) two clones sharing a repo name already share one dock section today,
 *        so they share one stored slot — the arrangement cannot tell them apart;
 *    (b) a branch rename or re-checkout produces a NEW label that appends at
 *        the bottom of its repo — the pinned position of the OLD name is gone
 *        with it, exactly as if the old terminal had been closed. */
export type DockOrder = readonly {
  repo: string;
  labels: readonly string[];
}[];
