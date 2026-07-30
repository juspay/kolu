/**
 * `pollOnChange` — the CLIENT dual of `pollOnEvent` (the server poll-on-event-tick
 * stream source). Where `pollOnEvent` reads on an event tick and yields
 * snapshot-then-deltas, `pollOnChange` subscribes a value-bearing PULSE stream (a
 * `{seq}` distinguisher), reads once immediately, and then re-runs a
 * request/response PROCEDURE on every pulse frame — the framework-free core of
 * the Code tab's
 * pulse-then-requery (W1.R4: push → pulse-then-requery, UX byte-identical bar
 * imperceptible extra latency).
 *
 * ZERO Solid / kolu imports — a plain async loop over `unenrolledStreamCall`. The
 * SolidJS ergonomics (the reconciled store, `.pending()`, the #818
 * selection-stability guard, the `active` pause/resume) wrap this core in
 * `packages/client`'s `createPolledQuery`.
 */

import { type StreamingProcedure, unenrolledStreamCall } from "./client";

export interface PollOnChangeOpts<PulseInput, Pulse, Result> {
  /** The value-bearing PULSE stream — a `{seq}` distinguisher. `unenrolledStreamCall`
   *  re-subscribes it transparently on reconnect (STREAM_RETRY re-yields its snapshot
   *  frame), so `query` fires per frame INCLUDING each post-reconnect snapshot — the
   *  value stream's reconnect-refresh, preserved. */
  pulse: StreamingProcedure<PulseInput, Pulse>;
  pulseInput: PulseInput;
  /** Read immediately, then re-run on every pulse frame (the initial snapshot +
   *  each on-disk change + each post-reconnect snapshot). The direct read keeps
   *  initial hydration independent of watcher setup; the pulse snapshot closes
   *  the race between that read and watcher installation. Reads are single-flight:
   *  pulses that arrive while a read is running coalesce into one trailing refresh.
   *  `signal` is aborted only when the poll ends, so a sustained pulse burst cannot
   *  starve every read. */
  query: (signal: AbortSignal) => Promise<Result>;
  /** A fresh result landed (from a read that was not aborted by teardown). */
  onResult: (result: Result) => void;
  /** A query OR pulse failure (never an abort). Routing BOTH channels here is what
   *  lets a persistent watcher failure (inotify ENOSPC) surface a real error, not
   *  just a toast — the caller decides how to present it. */
  onError: (err: unknown) => void;
  /** The pulse stream ended NORMALLY — a typed end (the host/entry left
   *  membership), never an abort. */
  onComplete: () => void;
  /** Tear down the whole poll: aborts the pulse subscription AND any in-flight
   *  requery (a late resolve must not land after the poll is gone). */
  signal: AbortSignal;
}

/** Query once, then subscribe to the pulse and requery per frame. Returns
 *  immediately; the loop runs until the pulse ends (`onComplete`) or `signal`
 *  aborts. */
export function pollOnChange<PulseInput, Pulse, Result>(
  opts: PollOnChangeOpts<PulseInput, Pulse, Result>,
): void {
  let queryCtl: AbortController | null = null;
  let refreshRequested = false;
  let stopped = false;

  // A burst is leading + trailing: start one read immediately, remember any pulse
  // that arrives while it runs, then perform exactly one follow-up read. Serial
  // reads cannot land out of order, and forward progress does not depend on finding
  // a quiet gap between filesystem events.
  const runQuery = (): void => {
    if (stopped) return;
    if (queryCtl) {
      refreshRequested = true;
      return;
    }

    const ctl = new AbortController();
    queryCtl = ctl;
    void (async () => {
      try {
        const result = await opts.query(ctl.signal);
        if (ctl.signal.aborted || stopped) return;
        opts.onResult(result);
      } catch (err) {
        if (ctl.signal.aborted || stopped) return;
        opts.onError(err);
      } finally {
        if (queryCtl === ctl) queryCtl = null;
        if (!stopped && refreshRequested) {
          refreshRequested = false;
          runQuery();
        }
      }
    })();
  };

  const stop = (): void => {
    stopped = true;
    refreshRequested = false;
    queryCtl?.abort();
    queryCtl = null;
  };
  // Teardown aborts the in-flight requery too (not just the pulse) — the caller's
  // `signal` is the single owner of the whole poll's lifetime.
  opts.signal.addEventListener("abort", stop, { once: true });

  // A notification stream is an invalidation channel, not the authority for
  // initial state. Hydrate directly so a delayed watcher subscription cannot
  // leave the consumer blank forever. The pulse stream's initial snapshot still
  // requests a refresh, closing the read-before-watch installation window.
  runQuery();

  void (async () => {
    try {
      for await (const _frame of await unenrolledStreamCall(
        opts.pulse,
        opts.pulseInput,
        { signal: opts.signal },
      )) {
        runQuery();
      }
      // Normal completion — the pulse iterable ended on its own, not an abort (an
      // aborted loop never falls through the `for await` here with `aborted` false).
      // Abort any in-flight requery FIRST: the pulse owns the query's lifetime, so a
      // late result must not call `onResult` AFTER `onComplete` has latched (the
      // subscription's value must not change once complete). The entry is gone, so
      // the discarded final requery would only have surfaced a stale/erroring read.
      stop();
      if (!opts.signal.aborted) opts.onComplete();
    } catch (err) {
      // Pulse failure — abort the in-flight requery FIRST, for the SAME reason: a
      // query that resolves after `onError` would call `onResult` and clear the
      // just-recorded failure, presenting a dead watcher (e.g. inotify ENOSPC) as
      // healthy stale data. The terminal error must own the query.
      stop();
      if (!opts.signal.aborted) opts.onError(err);
    }
  })();
}
