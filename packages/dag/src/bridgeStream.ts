/**
 * `bridgeStream` — the tap-pump primitive shared by both hosts that run the
 * provider DAG. Pumps a (possibly promised) async-iterable into a callback
 * until it ends or `signal` aborts, swallowing an abort as EXPECTED teardown
 * (a kill / link drop), never an error.
 *
 * Lives in `@kolu/terminal-dag` (not in either host) so kolu-server's
 * `LocalTerminalEndpoint` and kolu-watcher consume ONE copy — the provider DAG
 * runs behind both and feeds them identical channel callbacks, so a divergence
 * here (e.g. one copy missing the per-event fence) is the same class of bug on
 * both hosts. Hoisting it closes that drift.
 */

import type { Logger } from "pino";

/** Pump a tap stream into `onEvent` until it ends or `signal` aborts. The
 *  contract stream call resolves to the async iterable (a
 *  `ClientPromiseResult`), so the source is awaited first. An aborted stream
 *  surfaces as a thrown error, so an aborted signal is treated as expected
 *  teardown, not a failure.
 *
 *  `onError` fires only for a NON-abort stream failure (an abort is always
 *  swallowed). Enrichment taps (cwd / title / command-run / foreground) omit it
 *  — a dropped enrichment stream just stops updating that field, logged
 *  generically. The exit tap supplies one because a dropped *exit* stream is a
 *  lifecycle problem, not a missing field. */
export function bridgeStream<T>(
  log: Logger,
  source: AsyncIterable<T> | PromiseLike<AsyncIterable<T>>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
  onError?: (err: unknown) => void,
): void {
  void (async () => {
    try {
      const iter = await source;
      for await (const value of iter) {
        if (signal.aborted) return;
        try {
          onEvent(value);
        } catch (err) {
          // Per-event fence: a single bad event (a failed metadata publish, a
          // scratch-cleanup fs error on exit, …) must NOT escape and end the
          // `for await` loop — that would silence this tap (cwd / title /
          // foreground / exit) for the terminal for good. Log and keep
          // consuming. (This is the fence the dissolved agent metadata loop
          // carried in `applyAgentEvent`; it moved here with the taps.)
          log.error(
            { err },
            "pty tap onEvent threw (subscription kept alive)",
          );
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      if (onError) {
        onError(err);
        return;
      }
      log.error({ err }, "pty tap subscription failed");
    }
  })();
}
