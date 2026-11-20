import type { Page } from "playwright";

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
