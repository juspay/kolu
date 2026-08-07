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
 *  host for an in-session restore.
 *
 *  ── The restore's ANSWER ─────────────────────────────────────────────────
 *  Beside the phase, the latch parks ONE fact for the next view seed:
 *  `session.restore`'s answer to "which terminal is active now"
 *  ({@link HostRestoreLatch.restoredActive}). It lives HERE, not in the hook's
 *  signals, because it is per-HOST state whose lifetime is exactly one
 *  `decided → seeded` trip — the same span the phase names. Without it the seed
 *  fell back to the saved-session cell, whose post-restore snapshot publishes
 *  behind a synchronous disk write and so routinely arrives AFTER the terminals
 *  it describes. */
export type HydrationPhase = "pending" | "decided" | "seeded";

export interface HostRestoreLatch {
  /** The current phase — a NON-reactive gate the hydration effect reads. */
  readonly phase: HydrationPhase;
  /** `pending → decided`: the empty-vs-restore decision has run. Idempotent — a
   *  no-op once past `pending`, so it can never regress a `seeded` host. */
  markDecided(): void;
  /** `decided → seeded`: the client view-state seed (active tile + MRU + panels)
   *  ran. Guarded to advance ONLY from `decided`, so "seeded implies decided"
   *  holds by construction — the pending→seeded skip is unspellable through the
   *  API, not merely avoided by the effect's call ordering. */
  markSeeded(): void;
  /** `seeded → decided`: re-arm the view seed for an IN-SESSION restore (the
   *  `recycleKaval` recycle→restore, no page reload) — the restored terminals
   *  come back under FRESH ids whose client sub-panel state has never been seeded,
   *  so the hydration effect must re-run `hydrateFromTerminals` for them. It
   *  re-latches `seeded` after, so a later reconnect stays a no-op. */
  reseedForRestore(): void;
  /** The active-terminal marker `session.restore` ANSWERED with, for the restore
   *  this host is currently seeding — the id the seed must prefer over the saved
   *  session's.
   *
   *  A BOX, not a bare id, because the two absences are different facts: `null` is
   *  "no restore has answered, read the persisted marker", while `{ id: null }` is
   *  "the host answered, and it holds no active terminal". Collapsing them would
   *  send the seed back to the very blob this exists to stop it reading. */
  readonly restoredActive: { readonly id: string | null } | null;
  /** Record `session.restore`'s answer. Read once by the next view seed, which
   *  clears it — a consumed answer must never seed a LATER hydration. */
  reportRestoredActive(id: string | null): void;
  /** Drop an answer the seed could NOT use: the answered terminal never reached
   *  this host's `terminals` collection, so the seed's wait for it is over. The
   *  box is cleared WITHOUT advancing the phase — the next hydration seeds from
   *  the persisted marker instead of gating forever on an id the host no longer
   *  holds. Distinct from `markSeeded`, which spends an answer the seed actually
   *  consumed; both leave `restoredActive` null, so "the answer seeds exactly one
   *  hydration" still holds. */
  expireRestoredActive(): void;
}

export function createSessionRestore(): HostRestoreLatch {
  let phase: HydrationPhase = "pending";
  let restoredActive: { readonly id: string | null } | null = null;
  return {
    get phase() {
      return phase;
    },
    get restoredActive() {
      return restoredActive;
    },
    markDecided() {
      if (phase === "pending") phase = "decided";
    },
    markSeeded() {
      if (phase === "decided") {
        phase = "seeded";
        // The answer has been spent on THIS seed.
        restoredActive = null;
      }
    },
    reseedForRestore() {
      if (phase === "seeded") phase = "decided";
    },
    reportRestoredActive(id: string | null) {
      restoredActive = { id };
    },
    expireRestoredActive() {
      restoredActive = null;
    },
  };
}
