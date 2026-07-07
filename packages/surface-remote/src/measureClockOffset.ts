/**
 * Measure a bound daemon's wall-clock offset vs this process, over the frozen
 * control-core `clockNow` — the offset a keyed `SurfaceMap` folds into
 * `EntryStatus.connected` so two hosts render on two clocks WITHOUT comparing them.
 *
 * Lives here (not the app): the role slot (`DaemonSession.clockOffset()`,
 * `daemonSession.ts`) and its consumer (`serveHostMap`'s required
 * `ClockableSession`) are both framework — this is the ONE implementation of the
 * RTT-halved math either binder arm (or a paired framework consumer, e.g.
 * drishti) would otherwise have to re-derive to satisfy the same compile-time
 * requirement.
 */

/** The minimal client shape this needs — a control-core `clockNow`. Structural, so
 *  both binder arms' `PadiDaemonClient` fit with no import. */
type ClockNowClient = {
  surface: {
    control: { core: { clockNow: () => Promise<{ epochMs: number }> } };
  };
};

/** The far-end daemon's wall-clock offset (ms) vs THIS process, RTT-halved: sample
 *  `clockNow` around a round-trip so `offset = remoteEpoch - (sent + rtt/2)`. Call ONCE
 *  per admit/connect — offset-at-hello IS the contract (no continuous drift correction).
 *  A LOCAL padi (same wall clock) yields ~0 honestly.
 *
 *  A probe failure is NEVER swallowed into a fabricated/absent offset: it is LOGGED
 *  (via the optional `log` line-sink, the same `(line: string) => void` shape every
 *  other surface-remote diagnostic uses) and RETHROWN. The caller's connector/admit
 *  hook already runs inside `makeSession`'s `attempt()` (`./session.ts`), which turns
 *  any throw there into the honest `disconnected` state (with `lastError` carrying
 *  this reason) and schedules a reconnect — so a failed probe surfaces as a real,
 *  diagnosable state transition, never as a `null` that leaves the entry silently
 *  reading as eternal `connecting`/warming. */
export async function measureClockOffset(
  client: ClockNowClient,
  log?: (line: string) => void,
): Promise<number> {
  try {
    const sentMs = Date.now();
    const { epochMs } = await client.surface.control.core.clockNow();
    const rtt = Date.now() - sentMs;
    return Math.round(epochMs - (sentMs + rtt / 2));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log?.(`clock offset probe failed: ${reason}`);
    throw err instanceof Error ? err : new Error(reason);
  }
}
