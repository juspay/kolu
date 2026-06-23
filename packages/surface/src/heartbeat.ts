/**
 * The half-open-link watchdog, framework-free — one interval that races a cheap
 * `probe` against a `timeoutMs`, settles exactly once per tick (answer-or-timeout
 * wins, the other a no-op), skips a tick while a probe is still in flight, `unref`s
 * its timers, and a `dispose()` that clears an outstanding probe so it can't fire
 * late.
 *
 * A SILENTLY half-open link — TCP dead with no FIN/RST after a laptop sleep,
 * Wi-Fi roam, or a NAT/proxy evicting an idle connection — fires neither `close`
 * nor `error`, so without a watchdog the link sits "open" forever and every stream
 * hangs. This is the one algorithm that detects that and hands recovery back to
 * the transport, and it lives HERE once: both legs that need it consume it instead
 * of re-deriving it.
 *
 *   - the BROWSER leg (`@kolu/surface-app`'s partysocket `createHeartbeat`) passes
 *     `isLive: () => ws.readyState === ws.OPEN` and `onStale: () => ws.reconnect()`;
 *   - the SSH leg (`@kolu/surface-nix-host`'s HostSession) passes
 *     `isLive: () => this.connection === 'connected'` and `onStale: () => this.recheck()`.
 *
 * The two variation points the legs differ on — the "is the link live enough to
 * probe?" GATE and the "the link is lying, recover it" ACTION — are the two
 * injected callbacks (`isLive`, `onStale`); everything else (the race, the
 * single-settle, the skip-overlap, the late-fire-safe dispose, the
 * synchronous-throw branch) is shared.
 *
 * Framework-free: timers only, no SolidJS, no partysocket — so the ssh leg can
 * consume it without pulling in a browser transport. Lives in `@kolu/surface`
 * (which both legs already depend on) so the dependency arrow points OUT of both.
 */

/** How often the watchdog probes a live link, and how long it waits for an answer
 *  before declaring the link half-open. A healthy peer answers in milliseconds, so
 *  the 10s timeout is a confident dead-signal; the 15s interval keeps the keep-
 *  alive cheap. Worst-case auto-recovery after a link goes silently dead is one
 *  interval + one timeout (~25s). Single-sourced here so the browser leg and the
 *  ssh leg pin the SAME cadence by structure, not a convention comment. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

/** Options for {@link createHeartbeat}. */
export interface HeartbeatOptions {
  /** Gate: probe only when the link is live enough to answer. The browser leg
   *  passes `() => ws.readyState === ws.OPEN`; the ssh leg passes
   *  `() => this.connection === "connected"`. A tick where this is false is a
   *  no-op, so the (possibly minutes-long) connecting/backoff windows are never
   *  probed. */
  isLive: () => boolean;
  /** The recovery ACTION run when a probe TIMES OUT (the link is lying — "open"
   *  but not answering). The browser leg passes `() => ws.reconnect()`; the ssh
   *  leg passes `() => this.recheck()`. Run FIRST and guarded, so a throwing
   *  reporter (below) can never defeat the recovery this watchdog exists to
   *  provide. */
  onStale: () => void;
  /** A cheap round-trip whose RESOLUTION is the liveness signal (its value is
   *  ignored). A REJECTION still counts as alive — the round-trip completed (the
   *  peer answered, even with an error) — so only a TIMEOUT (no answer at all)
   *  means half-open. A SYNCHRONOUS throw is treated DIFFERENTLY: it means no
   *  round-trip happened (the probe is miswired), so it is reported via
   *  `onProbeError` and does NOT trigger the on-stale action. */
  probe: () => Promise<unknown>;
  /** How often to probe while `isLive()`. Default {@link DEFAULT_HEARTBEAT_INTERVAL_MS}. */
  intervalMs?: number;
  /** How long to wait for a probe before declaring the link half-open and running
   *  `onStale`. Default {@link DEFAULT_HEARTBEAT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Report a forced recovery (a missed probe). Optional — run guarded AFTER
   *  `onStale`, so it can never defeat the recovery. */
  onStaleReport?: () => void;
  /** Report a probe that threw SYNCHRONOUSLY (a miswired/broken probe, distinct
   *  from an async rejection). Optional. */
  onProbeError?: (error: unknown) => void;
}

/** Build the half-open-link watchdog. Each tick — only while `isLive()` — races
 *  `probe` against `timeoutMs`. A probe that doesn't answer in time means the
 *  link is half-open, so `onStale()` runs (abandon-and-recover). One miss forces
 *  the action (no multi-miss debounce that would only lengthen the freeze), and
 *  ticks never overlap: a tick is skipped while the previous probe is still
 *  outstanding. Returns `dispose()` to stop the interval AND any in-flight probe
 *  timeout, so a probe outstanding at teardown can't fire a late `onStale`. */
export function createHeartbeat(opts: HeartbeatOptions): {
  dispose: () => void;
} {
  const intervalMs = opts.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  let inFlight = false;
  let disposed = false;
  // The CURRENT probe's timeout, at function scope so `dispose()` can clear it —
  // otherwise a probe in flight at teardown would still run `onStale()` later.
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  // Resolve the current probe exactly once (the answer or the timeout wins, the
  // other becomes a no-op). On a timeout we run `onStale` FIRST and report SECOND,
  // each in a guarded block, so a throwing `onStale`/reporter can never defeat the
  // recovery this helper exists to provide. No-op once disposed.
  const settled = (stale: boolean) => {
    if (!inFlight || disposed) return;
    inFlight = false;
    if (probeTimer !== undefined) {
      clearTimeout(probeTimer);
      probeTimer = undefined;
    }
    if (stale) {
      try {
        opts.onStale();
      } catch {
        // A throwing recovery action must never unwind the watchdog timer.
      }
      try {
        opts.onStaleReport?.();
      } catch {
        // A throwing status reporter must never unwind anything either.
      }
    }
  };
  const tick = () => {
    if (inFlight || disposed) return;
    if (!opts.isLive()) return;
    inFlight = true;
    probeTimer = setTimeout(() => settled(true), timeoutMs);
    probeTimer.unref?.();
    // A SYNCHRONOUS throw from `probe` means NO round-trip was made at all — the
    // probe is miswired (a bad client cast, a missing method), not a liveness
    // signal — so it must NOT be silently classified as alive the way a genuine
    // async REJECTION (the peer answered with an error) is. We surface it and
    // settle WITHOUT running `onStale`: a broken probe is a local fault the link
    // can't fix, so a recovery would only churn. The watchdog goes inert until the
    // probe is fixed, but the report makes that visible instead of silent.
    let probing: Promise<unknown>;
    try {
      probing = opts.probe();
    } catch (error) {
      // Report in a guarded block, then ALWAYS `settled(false)` — a throwing
      // reporter must not leave `inFlight`/`probeTimer` armed, or this local probe
      // fault would later be misclassified as a stale transport and force a
      // spurious `onStale()` (and an uncaught error in the timer).
      try {
        opts.onProbeError?.(error);
      } catch {
        // A throwing status reporter must never defeat the settle below.
      }
      settled(false);
      return;
    }
    Promise.resolve(probing).then(
      () => settled(false),
      () => settled(false),
    );
  };
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return {
    dispose: () => {
      disposed = true;
      clearInterval(handle);
      if (probeTimer !== undefined) {
        clearTimeout(probeTimer);
        probeTimer = undefined;
      }
    },
  };
}
