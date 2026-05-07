import type { Page } from "playwright";

/** Poll until a condition is met, returning the last value on timeout. */
export async function pollUntil<T>(
  _page: Page,
  fn: () => Promise<T>,
  check: (val: T) => boolean,
  { attempts = 10, intervalMs = 100 } = {},
): Promise<T> {
  let val = await fn();
  for (let i = 1; i < attempts && !check(val); i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    val = await fn();
  }
  return val;
}

/** Deadline-based polling loop with a side-effect tick.
 *
 *  Resolves successfully as soon as `isDone(observe())` returns true.
 *  Throws (via `onTimeout`) if the deadline expires without success —
 *  the error message includes the actual elapsed time and the last
 *  observation, so `POLL_TIMEOUT + (one tick cost)` doesn't masquerade
 *  as exactly `POLL_TIMEOUT`.
 *
 *  `onTick` runs before each `observe()` call. Use it for WAL nudges
 *  (`nudgeWal`), self-heal re-POSTs, or `fs.utimesSync` re-touches —
 *  any side-effect that drives detection retries while the loop polls. */
export async function pollFor<T>(opts: {
  observe: () => Promise<T>;
  isDone: (v: T) => boolean;
  onTimeout: (last: T | undefined, elapsedMs: number) => Error;
  onTick?: () => void | Promise<void>;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<T> {
  const intervalMs = opts.intervalMs ?? 250;
  const start = Date.now();
  let last: T | undefined;
  while (Date.now() - start < opts.timeoutMs) {
    if (opts.onTick) await opts.onTick();
    last = await opts.observe();
    if (opts.isDone(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw opts.onTimeout(last, Date.now() - start);
}
