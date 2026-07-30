/** Generational supersession for restartable attach attempts.
 *
 *  A terminal's attach loop can be restarted while the previous one is still
 *  unwinding: the restart is triggered from an xterm write callback, but the
 *  async iterator behind it settles later and exposes no completion to await, so
 *  there is always a window in which BOTH loops exist. Anything the old loop
 *  still delivers in that window — a queued frame, a stashed write callback —
 *  must be inert, or it will consume after the successor's reset, commit a
 *  backfill seed belonging to a dead attempt, or restart the loop a second time.
 *
 *  The gate makes that unrepresentable by ordering rather than by cleanup: each
 *  `open()` supersedes every earlier attempt, and an attempt asks `isCurrent()`
 *  before acting. Superseded work is dropped, not cancelled — nothing has to
 *  successfully tear down for correctness to hold, which is the point, since the
 *  old loop's teardown is exactly what cannot be awaited. */
export interface AttemptGate {
  /** Begin an attempt, superseding every earlier one. */
  open(): Attempt;
}

export interface Attempt {
  /** False once a later attempt has opened — this one's work must do nothing. */
  isCurrent(): boolean;
}

export function createAttemptGate(): AttemptGate {
  let live = 0;
  return {
    open(): Attempt {
      const mine = ++live;
      return { isCurrent: () => mine === live };
    },
  };
}
