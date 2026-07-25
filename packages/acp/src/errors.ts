/**
 * Turning an error back into a sentence.
 *
 * JSON-RPC errors carry the useful part — *why* — in `data`, while `message` is
 * the generic code name. `String(error)` on one therefore yields "Internal
 * error", which tells an operator staring at a dead proxy nothing at all.
 */

/** A human-readable description, including the reason a JSON-RPC error hides. */
export function describeError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const { message, data } = error as { message?: unknown; data?: unknown };
  const base = typeof message === "string" ? message : String(error);
  const reason =
    typeof data === "object" && data !== null
      ? (data as { reason?: unknown }).reason
      : undefined;
  return typeof reason === "string" ? `${base}: ${reason}` : base;
}
