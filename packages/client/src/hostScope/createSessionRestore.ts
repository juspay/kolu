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
 *  DELIBERATELY a plain mutable record, NOT a reactive signal: the phase is a
 *  non-reactive GATE the hydration effect reads to decide whether to run — it is
 *  the effect's OTHER dependencies (`activeHost`, the terminal list, the server
 *  session) that drive re-runs. A reactive phase would change which reads re-arm
 *  the effect and is not what the gate is for.
 *
 *  ── `HydrationPhase` — the hand-rolled state machine, named ───────────────
 *  ONE phase, a union — NOT two independent booleans (the pre-W7 `decided` /
 *  `viewSeeded` pair, whose invalid combinations were never enumerated) — so the
 *  impossible "seeded but undecided" is unrepresentable (the view can't seed
 *  before the empty-vs-restore decision runs):
 *   - `pending`  — the empty-vs-restore decision has not run (initial).
 *   - `decided`  — decided (the restore card can show); the client view-state seed
 *     (active tile + MRU + panels) has NOT run yet. Also the phase an explicit
 *     in-session restore re-arms to. The empty-vs-restore OUTCOME is derived LIVE
 *     from `store.terminalIds()` at read time, never baked into the phase — so a
 *     restore that produces terminals after an empty decision seeds correctly
 *     without a stale `decided-empty`/`decided-restore` distinction to reconcile.
 *   - `seeded`   — decided AND the view seed ran.
 *
 *  The three transitions are NAMED (not raw `phase = "…"` writes scattered across
 *  the reader, and crucially not an out-of-band write from `handleRestoreSession`
 *  that the pre-W7 shape allowed): `markDecided` runs the decision once,
 *  `markSeeded` records the view seed, `reseedForRestore` re-arms an already-seeded
 *  host for an in-session restore. */
export type HydrationPhase = "pending" | "decided" | "seeded";

export interface HostRestoreLatch {
  /** The current phase — a NON-reactive gate the hydration effect reads. */
  readonly phase: HydrationPhase;
  /** `pending → decided`: the empty-vs-restore decision has run. Idempotent — a
   *  no-op once past `pending`, so it can never regress a `seeded` host. */
  markDecided(): void;
  /** `→ seeded`: the client view-state seed (active tile + MRU + panels) ran.
   *  Only ever called after `markDecided` (the effect gates on it), so "seeded
   *  implies decided" holds by construction. */
  markSeeded(): void;
  /** `seeded → decided`: re-arm the view seed for an IN-SESSION restore (the
   *  `recycleKaval` recycle→restore, no page reload) — the restored terminals
   *  come back under FRESH ids whose client sub-panel state has never been seeded,
   *  so the hydration effect must re-run `hydrateFromTerminals` for them. It
   *  re-latches `seeded` after, so a later reconnect stays a no-op. */
  reseedForRestore(): void;
}

export function createSessionRestore(): HostRestoreLatch {
  let phase: HydrationPhase = "pending";
  return {
    get phase() {
      return phase;
    },
    markDecided() {
      if (phase === "pending") phase = "decided";
    },
    markSeeded() {
      phase = "seeded";
    },
    reseedForRestore() {
      phase = "decided";
    },
  };
}
