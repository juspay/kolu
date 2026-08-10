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
  /** When the SERVER retired this tab — it presented a `?pid=` from a process
   *  that is gone, and the wire will never dial again. `undefined` ⇒ this tab is
   *  still bound to the process that served it. The terminal fact of the wire's
   *  life, and the one a bug report most wants: "the page you are looking at came
   *  from a server that stopped existing at 14:02". */
  readonly retiredAt: number | undefined;
}

let lastProbeAt: number | undefined;
let lastProbeOk: boolean | undefined;
let lastStaleAt: number | undefined;
let retiredAt: number | undefined;

/** The observer handed to `connectSurfaces`'s heartbeat tuning
 *  (`HeartbeatTuning.onProbeSettled`). Records only; the watchdog owns policy. */
export function recordProbeSettled(ok: boolean, atMs: number): void {
  lastProbeAt = atMs;
  lastProbeOk = ok;
  if (!ok) lastStaleAt = atMs;
}

/** The `retired` policy handed to `connectSurfaces` — the REQUIRED answer to
 *  "what happens when the server retires this wire". kolu's user-facing recovery
 *  is the restart overlay `rpc.ts`'s lifecycle drives off the same wire's terminal
 *  status, so what this adds is the RECORD: a wall-clock stamp the diagnostic
 *  snapshot reads, which is the one thing neither the overlay nor the console had.
 *  Idempotent — `retired` is terminal, so the first stamp is the true one. */
export function recordWireRetired(atMs: number = Date.now()): void {
  retiredAt ??= atMs;
}

/** A synchronous read of what this tab has observed — no wire, no clock. */
export function probeLog(): ProbeLog {
  return { lastProbeAt, lastProbeOk, lastStaleAt, retiredAt };
}
