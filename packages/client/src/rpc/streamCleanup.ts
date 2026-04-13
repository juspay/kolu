/**
 * True for async-iterator errors thrown by the consumer's own
 * `AbortController.abort()` on unmount — the one error shape every
 * streaming consumer in this client needs to ignore silently while
 * still surfacing everything else.
 */
export function isExpectedCleanupError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
