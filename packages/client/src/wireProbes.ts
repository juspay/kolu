/** The half-open watchdog's last verdict, as this tab observed it (kolu#2101 J2).
 *
 *  The watchdog probes `system/live` every 15s and forces a reconnect when one
 *  goes unanswered. Both facts matter to a diagnostic — "the last probe answered
 *  4s ago" is what tells a reader the wire in front of them is genuinely live
 *  rather than merely reporting `open`, and a recent stale verdict is the
 *  fingerprint of the re-dial cycle the parked-subscription incident rode in on.
 *  Neither was recorded anywhere before: the watchdog reported a stale verdict to
 *  `console.warn` and an alive one to nobody.
 *
 *  A LEAF module on purpose. `wire.ts` (which owns the `connectSurfaces` call
 *  that installs the observer) and `diagnosticSnapshot.ts` (which reads it) sit
 *  on opposite sides of an import edge — folding this into either would close a
 *  cycle biome's `noImportCycles` rejects. */

/** The probe verdicts this tab has observed, all wall-clock (`Date.now()`), so
 *  they read beside a server log and beside the link's dial history. */
export interface ProbeLog {
  /** When the last DEFINITIVE probe verdict landed — alive or stale. */
  readonly lastProbeAt: number | undefined;
  /** Whether that verdict was "the peer answered". `undefined` ⇒ no probe has
   *  settled yet (a tab up for less than one interval). */
  readonly lastProbeOk: boolean | undefined;
  /** When a probe last TIMED OUT and the watchdog forced a reconnect —
   *  `undefined` ⇒ never in this tab's life. */
  readonly lastStaleAt: number | undefined;
}

let lastProbeAt: number | undefined;
let lastProbeOk: boolean | undefined;
let lastStaleAt: number | undefined;

/** The observer handed to `connectSurfaces`'s heartbeat tuning
 *  (`HeartbeatTuning.onProbeSettled`). Records only; the watchdog owns policy. */
export function recordProbeSettled(ok: boolean, atMs: number): void {
  lastProbeAt = atMs;
  lastProbeOk = ok;
  if (!ok) lastStaleAt = atMs;
}

/** A synchronous read of what this tab has observed — no wire, no clock. */
export function probeLog(): ProbeLog {
  return { lastProbeAt, lastProbeOk, lastStaleAt };
}
