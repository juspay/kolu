/** Resolve `p` if it settles within `ms`; otherwise reject with a timeout error. */
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
