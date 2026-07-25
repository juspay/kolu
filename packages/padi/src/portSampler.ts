/**
 * The port scan's CADENCE — a 5-second baseline nudged by terminal output.
 *
 * The baseline alone would mean up to ~5 s between a dev server printing "ready"
 * and its chip appearing: the one UX cost the measured scan numbers (~3 ms on
 * linux, ~17 ms on macOS — two orders of magnitude of headroom at this cadence)
 * do not excuse. So the signals that already mark "something happened in this
 * terminal" — an output burst, an OSC 633 command mark — trigger an immediate
 * off-schedule pass.
 *
 * Output is only ever a HINT ABOUT WHEN TO LOOK. The socket table stays the sole
 * source of facts: a printed URL never creates a chip. That line is exactly where
 * VS Code's output mode went wrong — its terminal-URL regex CREATES forwards with
 * no liveness check, and most of its knob matrix exists to compensate for
 * forwarding on that uncertain evidence.
 *
 * Three properties, and the reason for each:
 *  - **Single-flight.** The nudge and the baseline share ONE non-overlapping
 *    runner, so a burst of output during a slow pass cannot stack passes on top
 *    of each other. A nudge that arrives mid-pass is remembered, not dropped —
 *    the running pass may have read `/proc` before the new listener existed.
 *  - **A ≥1 s floor between passes.** An agent streaming output would otherwise
 *    nudge every few milliseconds forever.
 *  - **The baseline still matters.** It catches a QUIET bind (a server that
 *    printed nothing) and, just as importantly, port DEATH — which PRT2's
 *    auto-cancel policy rides on.
 *
 * The timer is `unref`'d: a live readout must never be the reason the process
 * stays alive.
 */

import type { PortInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { type PortScanTarget, scanTerminalPorts } from "./portScan.ts";

/** Baseline cadence of the port scan. The same 5 s `memorySampler` uses, for the
 *  same reason: coarse enough to be free, live enough to be worth reading. */
export const PORT_SCAN_INTERVAL_MS = 5_000;

/** Floor between two passes, however many nudges arrive. */
export const PORT_SCAN_MIN_GAP_MS = 1_000;

export interface PortSampler {
  /** Something happened in a terminal — look sooner. Coalesced, floored, and a
   *  no-op while a pass is already in flight (that pass re-runs instead). */
  nudge(): void;
  /** Stop the baseline. Idempotent; a pass already in flight completes and its
   *  result is discarded. */
  dispose(): void;
}

/** Start the port sampler. `targets()` is re-read at the top of EVERY pass — that
 *  is what makes "repartition from the current root pids every tick" true of the
 *  running system rather than only of the scan function: a terminal that closed
 *  between two passes is simply not in the list.
 *
 *  `scan` is injectable so the cadence can be tested without an OS; production
 *  passes the real `scanTerminalPorts`. */
export function createPortSampler(opts: {
  targets: () => readonly PortScanTarget[];
  /** Deliver one terminal's re-sampled port set. Called for EVERY target of the
   *  pass, including those serving nothing — a terminal whose last port died must
   *  hear about the empty set. The consumer owns the structural dedup. */
  publish: (id: TerminalId, ports: readonly PortInfo[]) => void;
  log: Logger;
  scan?: (
    targets: readonly PortScanTarget[],
  ) => Promise<Map<TerminalId, PortInfo[]>>;
}): PortSampler {
  const scan = opts.scan ?? scanTerminalPorts;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let running = false;
  /** A nudge that arrived while a pass was in flight — that pass may have read
   *  the socket table BEFORE the event that prompted the nudge, so its result
   *  cannot be treated as covering it. */
  let nudgedDuringPass = false;
  let lastPassAt = 0;

  /** Arm the next pass, replacing any pending one. `delayMs` is clamped to the
   *  floor measured from the last pass, so the floor holds across the baseline
   *  and the nudge alike rather than being a property of one of them. */
  function arm(delayMs: number): void {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    const sinceLast = Date.now() - lastPassAt;
    const floored = Math.max(delayMs, PORT_SCAN_MIN_GAP_MS - sinceLast);
    timer = setTimeout(
      () => {
        timer = undefined;
        void pass();
      },
      Math.max(floored, 0),
    );
    timer.unref();
  }

  async function pass(): Promise<void> {
    if (disposed || running) return;
    const targets = opts.targets();
    lastPassAt = Date.now();
    if (targets.length === 0) {
      // No terminals, no OS work at all — not even a `/proc` readdir. The clock
      // keeps ticking so the first terminal of a session is picked up without the
      // sampler needing to be re-armed from outside.
      arm(PORT_SCAN_INTERVAL_MS);
      return;
    }
    running = true;
    nudgedDuringPass = false;
    try {
      const ports = await scan(targets);
      if (disposed) return;
      for (const target of targets) {
        const sample = ports.get(target.id);
        if (sample === undefined) {
          // The scan's contract is that EVERY requested id comes back — with an
          // empty array when the terminal serves nothing. A missing key is
          // therefore a scan that failed to answer, not a terminal with no ports,
          // and defaulting it to `[]` would publish exactly the lie this whole
          // module's error handling exists to avoid. Throw into the blindness arm
          // below, which leaves the last sample standing.
          throw new Error(
            `port scan returned no sample for requested terminal ${target.id}`,
          );
        }
        opts.publish(target.id, sample);
      }
    } catch (err) {
      // A scan that could not SEE (an EACCES on a requested subtree, a netstat
      // that timed out) must not publish an empty set — that reads identically to
      // "this terminal serves nothing". Publishing nothing leaves the last known
      // sample standing and logs the blindness; the next pass re-reads.
      opts.log.error(
        { err },
        "port scan failed — ports left at their last sample",
      );
    } finally {
      running = false;
      if (!disposed) {
        // A nudge that landed mid-pass earned its own pass (floored), rather than
        // waiting out the full baseline behind a pass that may have missed it.
        arm(nudgedDuringPass ? 0 : PORT_SCAN_INTERVAL_MS);
        nudgedDuringPass = false;
      }
    }
  }

  arm(PORT_SCAN_INTERVAL_MS);

  return {
    nudge: () => {
      if (disposed) return;
      if (running) {
        nudgedDuringPass = true;
        return;
      }
      arm(0);
    },
    dispose: () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
