/**
 * `withTimeout` — race a promise against a deadline; the loser rejects, and the
 * timer is always cleared. The shared home for the "bound a possibly-hanging async
 * op" shape used by the kaval status sampler (`hostInventory`) and the handshake
 * read (`ptyHost/connect`), so the two don't each hand-roll a `Promise.race` +
 * `clearTimeout` (and the darwin `unref` so the timer never keeps the loop alive).
 */

/** Resolve `p` if it settles within `ms`; otherwise reject with a timeout error.
 *  The timer is cleared on either outcome, and `unref`'d so it never on its own
 *  keeps the event loop alive. */
export function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message = `timed out after ${ms}ms`,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
