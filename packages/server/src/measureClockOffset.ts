/**
 * Measure a bound daemon's wall-clock offset vs this process, over the frozen
 * control-core `clockNow` — the offset a keyed `SurfaceMap` folds into
 * `EntryStatus.connected` so two hosts render on two clocks WITHOUT comparing them.
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
 *  Returns `null` on any probe failure, so the entry honestly stays warming rather than
 *  publishing a fabricated `0`. A LOCAL padi (same wall clock) yields ~0 honestly. */
export async function measureClockOffset(
  client: ClockNowClient,
): Promise<number | null> {
  try {
    const sentMs = Date.now();
    const { epochMs } = await client.surface.control.core.clockNow();
    const rtt = Date.now() - sentMs;
    return Math.round(epochMs - (sentMs + rtt / 2));
  } catch {
    return null;
  }
}
