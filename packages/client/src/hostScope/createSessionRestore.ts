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
 *  ONE `state` field, a union — NOT two independent booleans — so the impossible
 *  "seeded but undecided" is unrepresentable (the view can't be seeded before the
 *  empty-vs-restore decision runs; that invariant was previously upheld only by
 *  call-site discipline):
 *  - `undecided` — the empty-vs-restore decision has not run (initial).
 *  - `decided-unseeded` — decided (the restore card can show), the client view-state
 *    seed has NOT run yet. Also the state an explicit in-session restore re-arms to.
 *  - `decided-seeded` — decided AND the view seed (active tile + MRU + panels) ran. */
export type RestoreLatchState =
  | "undecided"
  | "decided-unseeded"
  | "decided-seeded";

export interface HostRestoreLatch {
  state: RestoreLatchState;
}

export function createSessionRestore(): HostRestoreLatch {
  return { state: "undecided" };
}
