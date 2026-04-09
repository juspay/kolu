/**
 * Shared discriminator for "expected" stream-cleanup errors.
 *
 * Async iterator consumers (Terminal attach, TerminalPreview attach,
 * subscribeExit, generic createSubscription) all need to tell the
 * difference between an AbortError thrown by the consumer's own
 * `AbortController.abort()` on unmount — which is routine — and a real
 * failure that should surface to the user.
 *
 * A single helper avoids three locations drifting: before this module
 * existed, Terminal.tsx discriminated correctly but TerminalPreview and
 * subscribeExit used bare `catch {}`, silently swallowing genuine errors
 * that now arrive via ClientRetryPlugin's shouldRetry rejection (e.g.
 * TerminalNotFoundError after a server restart).
 */

export function isExpectedCleanupError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
