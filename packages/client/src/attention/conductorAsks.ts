/** The Conductor's bell — when a question the conversation puts to you rings.
 *
 *  A conversation blocked on a question is `asking` in exactly the sense a
 *  terminal is, so it rides the SAME channel (`useAttention` hands the
 *  delivery in): one sound, one notification seam, one switch. What is
 *  decided here is only WHEN, off the wire so it is unit-testable — the same
 *  split `attentionCore` makes for terminals.
 *
 *  The unit is the question's ID, not the count of open questions. Two
 *  changes can land in one reading — one question settled and a different one
 *  opened — and a count reads that 1 → 1 as nothing happening.
 *
 *  The rules:
 *    • Attention is a TRANSITION, not a discovery. The first reading is a
 *      baseline and never rings — reloading a tab onto a conversation that has
 *      been waiting for an hour must not ring for that hour-old question.
 *    • A reading rings once when it holds at least one id the last reading did
 *      not — and only if alerts are on and the conversation is not already in
 *      front of you.
 *    • The remembered set moves whether or not it rang. A question you watched
 *      arrive, or one that arrived while alerts were off, is SEEN: it must not
 *      ring the moment you look away or turn alerts back on. */

export interface ConductorAskHooks {
  /** The master gate — the `attentionAlerts` preference. */
  alertsEnabled(): boolean;
  /** "Seen with your eyes", one level up from a terminal: the conversation's
   *  questions are in front of you when its tab is the one on screen and the
   *  window has focus. Ringing then teaches people to ignore the bell. */
  isWatched(): boolean;
  /** Reach the user — the sound and the notification — with how many
   *  questions are open now. */
  deliver(openCount: number): void;
}

export interface ConductorAsks {
  /** Feed the ids of the questions open right now. Read once, during the
   *  call; the array itself is not kept. */
  observe(openAsks: readonly string[]): void;
}

export function createConductorAsks(hooks: ConductorAskHooks): ConductorAsks {
  let seen: ReadonlySet<string> | undefined;
  return {
    observe(openAsks) {
      const before = seen;
      seen = new Set(openAsks);
      if (before === undefined) return;
      if (!openAsks.some((id) => !before.has(id))) return;
      if (!hooks.alertsEnabled() || hooks.isWatched()) return;
      hooks.deliver(openAsks.length);
    },
  };
}
