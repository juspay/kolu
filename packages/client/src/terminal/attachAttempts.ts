import type { Fiber } from "effect";

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

/**
 * Wrap an effect so it runs only while `attempt` is the live one.
 *
 * EVERY effect an attempt can still trigger after supersession has to go through
 * this, not just the obvious ones. A superseded loop reaches further than its
 * frames: its transport-retry and re-attach hooks can still reset the screen —
 * wiping the successor's authoritative snapshot — and its render-recovery pings
 * still report activity for a stream nobody is reading. Those are attempt-owned
 * lifecycle paths exactly as much as frame delivery is, so they are wrapped the
 * same way and the guard is one named thing rather than a condition each call
 * site re-remembers.
 */
export function onlyWhenCurrent<A extends unknown[]>(
  attempt: Attempt,
  effect: (...args: A) => void,
): (...args: A) => void {
  return (...args: A) => {
    if (attempt.isCurrent()) effect(...args);
  };
}

/** One attempt's OWN fiber, interruptible before the fork has handed it back.
 *
 *  An attempt that ends itself (a reassert, or a transport retry that must not
 *  replay) interrupts its fiber from code the fiber itself is running: the
 *  fence's `onRetry` hook runs inside the stream. If a drop could fail the
 *  first subscribe in the same turn as the fork, the hook would run before the
 *  fork returned the handle — and an interrupt aimed at "the attach fiber"
 *  would hit nothing, or worse, a successor's. So the attempt keeps its own
 *  handle, and an interrupt asked for before it exists is OWED and applied the
 *  moment the fork returns. The fence then is in its retry pause, so the
 *  replay still never goes out. */
export interface OwnFiber {
  /** The attempt's fiber, as the fork returned it. Applies an owed interrupt. */
  set(fiber: Fiber.Fiber<unknown, unknown>): void;
  /** Interrupt this attempt's fiber — now, or as soon as it has one. */
  interrupt(): void;
}

export function createOwnFiber(): OwnFiber {
  let fiber: Fiber.Fiber<unknown, unknown> | null = null;
  let owed = false;
  return {
    set(next) {
      fiber = next;
      if (owed) fiber.interruptUnsafe();
    },
    interrupt() {
      if (fiber) fiber.interruptUnsafe();
      else owed = true;
    },
  };
}
