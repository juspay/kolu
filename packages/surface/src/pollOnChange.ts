/**
 * `pollOnChange` — the CLIENT dual of `pollOnEvent` (the server poll-on-event-tick
 * stream source). Where `pollOnEvent` reads on an event tick and yields
 * snapshot-then-deltas, `pollOnChange` subscribes a value-bearing PULSE stream (a
 * `{seq}` distinguisher) and, on every frame, re-runs a request/response PROCEDURE
 * and emits the result — the framework-free core of the Code tab's
 * pulse-then-requery (W1.R4: push → pulse-then-requery, UX byte-identical bar
 * imperceptible extra latency).
 *
 * ZERO Solid / kolu imports — a plain async loop over `unenrolledStreamCall`. The
 * SolidJS ergonomics (the reconciled store, `.pending()`, the #818
 * selection-stability guard, the `active` pause/resume) wrap this core in
 * `packages/client`'s `createPolledQuery`.
 */

import { type StreamingProcedure, unenrolledStreamCall } from "./client";
import { runStreamScoped } from "./runStream";

export interface PollOnChangeOpts<PulseInput, Pulse, Result> {
  /** The value-bearing PULSE stream — a `{seq}` distinguisher. `unenrolledStreamCall`
   *  re-subscribes it transparently on reconnect (STREAM_RETRY re-yields its snapshot
   *  frame), so `query` fires per frame INCLUDING each post-reconnect snapshot — the
   *  value stream's reconnect-refresh, preserved. */
  pulse: StreamingProcedure<PulseInput, Pulse>;
  pulseInput: PulseInput;
  /** Re-run on every pulse frame (the initial snapshot + each on-disk change + each
   *  post-reconnect snapshot). `signal` aborts a SUPERSEDED in-flight read — a newer
   *  pulse frame, or teardown — so a slow read can never land over a fresher frame. */
  query: (signal: AbortSignal) => Promise<Result>;
  /** A fresh result landed (from a read that was not superseded/aborted). */
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

/** Subscribe the pulse and requery per frame. Returns immediately; the loop runs
 *  until the pulse ends (`onComplete`) or `signal` aborts. */
export function pollOnChange<PulseInput, Pulse, Result>(
  opts: PollOnChangeOpts<PulseInput, Pulse, Result>,
): void {
  // Abort-supersede: a newer pulse frame's requery cancels an older in-flight one,
  // so a slow read never lands its result over a fresher frame's.
  let queryCtl: AbortController | null = null;
  const runQuery = (): void => {
    queryCtl?.abort();
    const ctl = new AbortController();
    queryCtl = ctl;
    void (async () => {
      try {
        const result = await opts.query(ctl.signal);
        if (ctl.signal.aborted) return;
        opts.onResult(result);
      } catch (err) {
        if (ctl.signal.aborted) return;
        opts.onError(err);
      }
    })();
  };
  // Abort whatever requery is in flight — used at teardown and before every
  // terminal pulse callback (a function boundary so it reads the closure-mutated
  // `queryCtl`, not the flow-narrowed initial `null`).
  const abortInFlightQuery = (): void => {
    queryCtl?.abort();
  };
  if (opts.signal.aborted) return;

  // The pulse subscription runs on its own scoped fiber (the ONE Effect→callback
  // edge). `runStreamScoped` guarantees that once its stopper has run, nothing
  // reports — so the old `!opts.signal.aborted` guards on the terminal callbacks
  // are gone: teardown silence is the edge's rule, held in one place.
  const stopPulse = runStreamScoped<Pulse>(
    // Labelled for the liveness registry (kolu#2101 J2) — a poller whose pulse
    // parked looks exactly like one whose upstream is simply quiet, and the
    // registry's frame timestamps are the only thing that tells them apart.
    unenrolledStreamCall(opts.pulse, opts.pulseInput, {
      label: "pollOnChange.pulse",
    }),
    {
      onFrame: runQuery,
      // Normal completion — the pulse ended on its own. Abort any in-flight requery
      // FIRST: the pulse owns the query's lifetime, so a late result must not call
      // `onResult` AFTER `onComplete` has latched (the subscription's value must not
      // change once complete). The entry is gone, so the discarded final requery
      // would only have surfaced a stale/erroring read.
      onEnd: () => {
        abortInFlightQuery();
        opts.onComplete();
      },
      // Pulse failure — abort the in-flight requery FIRST, for the SAME reason: a
      // query that resolves after `onError` would call `onResult` and clear the
      // just-recorded failure, presenting a dead watcher (e.g. inotify ENOSPC) as
      // healthy stale data. The terminal error must own the query.
      onFailure: (err) => {
        abortInFlightQuery();
        opts.onError(err);
      },
    },
  );

  // Teardown stops the pulse fiber AND aborts the in-flight requery (not just one) —
  // the caller's `signal` is the single owner of the whole poll's lifetime.
  opts.signal.addEventListener(
    "abort",
    () => {
      stopPulse();
      abortInFlightQuery();
    },
    { once: true },
  );
}
