import { isPadiWarmingUp, RpcCallFailed } from "./rpcWire.ts";

const TRANSIENT_SETUP_ERRORS = [
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "socket hang up",
  "read ECONNRESET",
  "ETIMEDOUT",
  "EADDRNOTAVAIL",
];

/** Collect errno `code`s from an error tree. Node raises a dual-stack
 * `AggregateError` for a refused connection whose useful cause is nested. */
export function errorCodes(err: unknown, out: string[] = []): string[] {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") out.push(code);
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) errorCodes(cause, out);
    const inner = (err as { errors?: unknown }).errors;
    if (Array.isArray(inner)) for (const e of inner) errorCodes(e, out);
  }
  return out;
}

export function isTransientSetupError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (TRANSIENT_SETUP_ERRORS.some((needle) => msg.includes(needle)))
    return true;
  return errorCodes(err).some((code) => TRANSIENT_SETUP_ERRORS.includes(code));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry transport failures during scenario setup. An {@link RpcCallFailed} is an
 * ANSWERED call (the wire carried the server's failure back), so its message can never
 * masquerade as a transport error — it breaks out immediately, exactly as a completed
 * HTTP response used to. */
export async function retryTransient<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (err instanceof RpcCallFailed) break;
      if (!isTransientSetupError(err) || attempt === 3) break;
      await sleep(100 * attempt);
    }
  }
  if (last instanceof RpcCallFailed) throw last;
  const codes = errorCodes(last);
  const suffix = codes.length ? ` [${[...new Set(codes)].join(",")}]` : "";
  throw last instanceof Error
    ? new Error(`${label} failed after retries: ${last.message}${suffix}`, {
        cause: last,
      })
    : new Error(`${label} failed after retries: ${String(last)}${suffix}`);
}

/** Retry an idempotent whole-Padi scenario reset only when the re-serve says
 * its upstream link disappeared. Every other failure stays fail-fast. */
export async function retryPadiScenarioReset(
  timeoutMs: number,
  attempt: (remainingMs: number) => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Padi scenario reset never completed within ${timeoutMs}ms`,
      );
    }
    try {
      await attempt(remaining);
      return;
    } catch (err) {
      if (isPadiWarmingUp(err)) continue;
      throw err;
    }
  }
}
