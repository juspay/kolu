import type { Page } from "playwright";

/** Poll until a condition is met, returning the last value on timeout. */
export async function pollUntil<T>(
  page: Page,
  fn: () => Promise<T>,
  check: (val: T) => boolean,
  { attempts = 10, intervalMs = 100 } = {},
): Promise<T> {
  let val = await fn();
  for (let i = 1; i < attempts && !check(val); i++) {
    await page.waitForTimeout(intervalMs);
    val = await fn();
  }
  return val;
}
