/** Run `fn` once when `signal` aborts; the returned dispose drops the listener,
 *  so a caller that finishes first retains nothing on a long-lived signal. */
export function onAbortOnce(signal: AbortSignal, fn: () => void): () => void {
  // An ALREADY-aborted signal is answered without waiting: per WHATWG,
  // `addEventListener("abort")` on an aborted signal NEVER fires.
  if (signal.aborted) {
    fn();
    return () => {};
  }
  signal.addEventListener("abort", fn, { once: true });
  return () => signal.removeEventListener("abort", fn);
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    release();
    resolve();
  }, ms);
  timer.unref?.();
  const release = onAbortOnce(signal, () => {
    clearTimeout(timer);
    resolve();
  });
  return promise;
}
