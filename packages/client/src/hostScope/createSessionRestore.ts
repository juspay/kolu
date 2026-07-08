/** `createSessionRestore` — ONE host's restore latch, born inside its
 *  `scopedByEntry` owner.
 *
 *  The successor to `useSessionRestore`'s hand-rolled `Map<string, {decided,
 *  seeded}>` keyed by `encodeHostKey(activeHost())`. The map DIES: the owner IS
 *  the host, so a host's latch is just this record, retained across switch-away
 *  and disposed with the host on membership exit — a switch-back keeps the
 *  already-`seeded` decision (in-memory wins; the server SavedSession seeds only
 *  the first visit), a genuinely-new host re-runs decision + hydration.
 *
 *  DELIBERATELY a plain mutable record, not signals: the two flags are a
 *  non-reactive GATE the hydration effect reads to decide whether to run — it is
 *  the effect's other dependencies (`activeHost`, the terminal list, the server
 *  session) that drive re-runs. Reactivity here would change which reads re-arm
 *  the effect and is not what the flags are for. Matches the shipped latch's
 *  semantics exactly.
 *
 *  - `decided` — the empty-vs-restore decision has been made for this host (drives
 *    the restore card).
 *  - `seeded` — the client view-state seed (active tile + MRU + panels) has run
 *    for this host. Re-armed to `false` by an explicit in-session restore. */
export interface HostRestoreLatch {
  decided: boolean;
  seeded: boolean;
}

export function createSessionRestore(): HostRestoreLatch {
  return { decided: false, seeded: false };
}
