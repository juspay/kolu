/** Resolve after `ms`, or early if `signal` aborts — so a shutdown during a wait
 *  ends the caller promptly instead of after the full delay.
 *
 *  Removes its abort listener on BOTH exits — the timeout path removes it
 *  explicitly, the abort path is registered `{ once: true }` so it auto-removes
 *  after firing. That symmetry is load-bearing for the re-subscribe loops that
 *  call this on a fixed cadence (`liveActivity`, `inventoryReconcile`): a bare
 *  `signal.addEventListener("abort", …)` that never removes on timeout would
 *  accrete one retained closure per retry on the loop's long-lived signal — an
 *  unbounded listener leak across a sustained daemon outage. The timer is
 *  `unref`'d so a pending delay never keeps the process alive on its own (the
 *  serve link does). */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
