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
 * ## The cadence is DECLARED, not implemented
 *
 * This module used to hand-roll the loop: a `setTimeout` chain, a `running`
 * non-overlap flag, a mid-flight nudge latch, an error arm that held the last
 * sample, an `unref`, and a `disposed` teardown latch. Every one of those belongs
 * to the reactor's poll source (`@kolu/surface`'s `reactor.ts`), which is where
 * padi's `memorySampler` and host-inventory samplers already read them from:
 *
 *  - `source({ read, install })` owns the T+0 seed, the non-overlap (`inFlight`)
 *    guard, the mid-flight coalesce (a tick that arrives during a read LATCHES and
 *    a trailing read runs after it — the property this module argued for by hand),
 *    later-read LOG-SKIP-CONTINUE, and teardown through the connector's signal.
 *  - `everyMs` owns the `unref`'d interval; `everyMsOr(ms, subscribe)` owns the
 *    interval-plus-edge fuse — itself the graduated form of two app-local twins of
 *    exactly this shape.
 *
 * What is left here is the one policy that is genuinely padi's: the **≥1 s floor**
 * on the nudge edge. "How often may this host's output nudge us?" is a domain
 * question the reactor deliberately declines to name, so it is a throttle wrapped
 * around the edge subscription rather than a new knob on the framework. Note the
 * narrowing that buys: the floor now governs the EDGE only, not the interval —
 * a nudge landing right after a baseline pass may scan again at once (one extra
 * ~3 ms pass), while the unbounded case the floor exists for (an agent streaming
 * output, nudging every few milliseconds forever) is still bounded to one pass per
 * gap.
 *
 * ## The two remaining properties, and why
 *
 *  - **The baseline still matters.** It catches a QUIET bind (a server that
 *    printed nothing) and, just as importantly, port DEATH — which PRT2's
 *    auto-cancel policy rides on.
 *  - **A pass is ALL OR NOTHING.** The read joins the whole scan to the whole
 *    target list and returns one map; a scan that could not answer for any one
 *    target re-serves the last map instead. There is no way to spell "published
 *    the first two targets, then failed", which is what a per-target publish loop
 *    with a throw in it did.
 */

import type { PortInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { everyMsOr, source } from "@kolu/surface/reactor";
import type { Logger } from "pino";
import {
  PortScanError,
  portScanSupported,
  scanTerminalPorts,
} from "./portScan.ts";

/** Baseline cadence of the port scan. The same 5 s `memorySampler` uses, for the
 *  same reason: coarse enough to be free, live enough to be worth reading. */
export const PORT_SCAN_INTERVAL_MS = 5_000;

/** Floor between two NUDGED passes, however many nudges arrive. */
export const PORT_SCAN_MIN_GAP_MS = 1_000;

/** One terminal to attribute ports to — its id and the ROOT pid of its PTY (the
 *  shell for a shell-rooted terminal, the command for a command-rooted one). The
 *  pid → terminal join lives HERE rather than in the scan, which knows only about
 *  pids: this is where the app's identity vocabulary belongs. The targets are
 *  re-read every pass; nothing holds them. */
export interface PortScanTarget {
  id: TerminalId;
  rootPid: number;
}

export interface PortSampler {
  /** Something happened in a terminal — look sooner. Floored to one pass per
   *  {@link PORT_SCAN_MIN_GAP_MS}, and coalesced by the poll source: a nudge that
   *  lands mid-pass makes that pass re-run rather than being dropped (the running
   *  pass may have read the socket table before the new listener existed). */
  nudge(): void;
  /** Stop the cadence. Idempotent; a pass already in flight completes and its
   *  result is discarded. */
  dispose(): void;
}

/** A THROTTLED edge: `fire()` passes the first call straight through and then
 *  coalesces everything inside `minGapMs` into a single trailing call at the end
 *  of the gap. The padi-side residue of the cadence — see the module header for
 *  why it lives here and not in the reactor's cadence family. The timer is
 *  `unref`'d for the same reason `everyMs`'s interval is: a live readout must
 *  never be the reason the process stays alive. */
function flooredEdge(
  tick: () => void,
  minGapMs: number,
): { fire: () => void; cancel: () => void } {
  let lastAt = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const run = (): void => {
    lastAt = Date.now();
    tick();
  };
  return {
    fire: () => {
      if (pending !== undefined) return; // already coalescing into the trailing call
      const since = Date.now() - lastAt;
      if (since >= minGapMs) {
        run();
        return;
      }
      pending = setTimeout(() => {
        pending = undefined;
        run();
      }, minGapMs - since);
      pending.unref();
    },
    cancel: () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
    },
  };
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
  scan?: (rootPids: readonly number[]) => Promise<Map<number, PortInfo[]>>;
}): PortSampler {
  const scan = opts.scan ?? scanTerminalPorts;
  // The permanent refusal, asked BEFORE the cadence exists. Checking it inside the
  // read could not deliver the "say it once, then stop" contract: the first read on
  // a host with no terminals yet answers an empty map without reaching the platform
  // switch, so the refusal would land on a later tick — where the poll source logs
  // and holds, and "stop" quietly becomes an error every 5 s forever. An injected
  // `scan` is a test's own business and is never gated on the real platform.
  if (opts.scan === undefined && !portScanSupported()) {
    opts.log.error(
      { platform: process.platform },
      "port scan unsupported on this platform — the Ports section will stay empty; not arming the sampler",
    );
    return { nudge: () => {}, dispose: () => {} };
  }
  /** The last map a pass actually produced, per SAMPLED LIFECYCLE (`id` + the
   *  `rootPid` it was read from). Keyed by id alone it outlived the terminal it
   *  described: sleep/wake deliberately reuses the same terminal UUID with a NEW
   *  root pid, so a blind pass after a wake re-served the PRE-SLEEP process tree's
   *  ports into the fresh sensor — whose dedup baseline had just been reset, so it
   *  published them. The Inspector would then show, and offer to open, a service
   *  that was never attributed to the current PTY.
   *
   *  A blind pass still RE-SERVES rather than publishing an empty set — `[]` reads
   *  byte-identically to "this terminal serves nothing"
   *  (`caught-error-must-not-collapse-to-empty`) — but only to the lifecycle that
   *  actually produced it. */
  let last = new Map<
    TerminalId,
    { rootPid: number; ports: readonly PortInfo[] }
  >();
  /** The nudge edge, live only while the cadence is installed. */
  let edge: { fire: () => void; cancel: () => void } | undefined;

  const node = source<
    ReadonlyMap<TerminalId, { rootPid: number; ports: readonly PortInfo[] }>
  >({
    // TOTAL by the poll source's contract: a transient failure logs and re-serves
    // the last map, so it can never tear the cadence down. Only a genuinely
    // permanent failure is allowed to propagate out of here.
    read: async () => {
      const targets = opts.targets();
      // No terminals, no OS work at all — not even a `/proc` readdir. The interval
      // keeps ticking, so the first terminal of a session is picked up without the
      // sampler needing to be re-armed from outside.
      if (targets.length === 0) return new Map();
      try {
        const byPid = await scan(targets.map((t) => t.rootPid));
        // The scan's contract is that EVERY requested pid comes back — with an
        // empty array when its subtree serves nothing. A missing key is a scan
        // that failed to answer, not a terminal with no ports, so the whole pass
        // is void: publishing the targets that DID answer would leave a mixed
        // old/new sample whose halves depend on iteration order.
        const missing = targets.filter((t) => !byPid.has(t.rootPid));
        if (missing.length > 0) {
          opts.log.error(
            { missing: missing.map((t) => t.id) },
            "port scan did not answer for every requested terminal — ports left at their last sample",
          );
          return last;
        }
        last = new Map(
          targets.map((t) => [
            t.id,
            { rootPid: t.rootPid, ports: byPid.get(t.rootPid)! },
          ]),
        );
        return last;
      } catch (err) {
        // The PERMANENT arm propagates: a platform this scan cannot read will not
        // become readable in five seconds, so retrying it is a caught error
        // degrading into an error loop instead of surfacing. It faults the seed
        // (the `.catch` below stops the sampler and says so, once) rather than
        // logging forever with the cadence dutifully re-arming.
        if (err instanceof PortScanError && err.kind === "unsupported-platform")
          throw err;
        // Everything else is THIS pass failing to see (an EACCES on a requested
        // subtree, an lsof that timed out) and must not publish an empty set.
        //
        // Name the terminals we hold NO last-good sample for. For those, holding
        // the last sample cannot preserve the never-look-empty invariant — there is
        // nothing to hold, and `seedSnapshot` has already put them at `ports: []`,
        // which reads exactly like "serves nothing". Saying which ones makes that
        // window visible to an operator instead of silent; representing it ON THE
        // WIRE would need a sampling-status discriminator, recorded as a PRT2 shape
        // question beside the `wildcard`/`scope` one.
        const neverSampled = opts
          .targets()
          .filter((t) => last.get(t.id)?.rootPid !== t.rootPid)
          .map((t) => t.id);
        opts.log.error(
          { err, neverSampled },
          neverSampled.length > 0
            ? "port scan failed — ports left at their last sample; these terminals have none yet, so they still read as serving nothing"
            : "port scan failed — ports left at their last sample",
        );
        return last;
      }
    },
    install: everyMsOr(PORT_SCAN_INTERVAL_MS, (tick) => {
      const floored = flooredEdge(tick, PORT_SCAN_MIN_GAP_MS);
      edge = floored;
      return () => {
        edge = undefined;
        floored.cancel();
      };
    }),
  });

  // Driven OUTSIDE a `derived.cell`: these samples are not a wire member of padi's
  // surface — each terminal's set re-enters its own producer through the sensor
  // channel, so the fan-out below IS the publisher. `connectPoll` is public on
  // `PollSource` for exactly this, and its abort signal is the sampler's teardown.
  const abort = new AbortController();
  const sampler: PortSampler = {
    nudge: () => edge?.fire(),
    dispose: () => abort.abort(),
  };
  void node
    .connectPoll((byTerminal) => {
      // FRESHNESS CHECK at the publish boundary, not the read one. Between a scan
      // starting and its result landing, a terminal can sleep and wake — which
      // deliberately keeps its id and gets a NEW root pid — so an id-keyed publish
      // would deliver the pre-sleep process tree's ports into the woken terminal's
      // fresh sensor, whose dedup baseline has just been reset and would therefore
      // emit them. The Inspector would show, and offer to open, a service that was
      // never attributed to the current PTY.
      //
      // Re-reading `targets()` HERE is what makes that unspellable: a sample is
      // published only to the exact lifecycle that produced it. A terminal that
      // changed identity simply hears nothing this pass and is sampled afresh on
      // the next one.
      const live = new Map(opts.targets().map((t) => [t.id, t.rootPid]));
      for (const [id, sample] of byTerminal) {
        if (live.get(id) !== sample.rootPid) continue;
        opts.publish(id, sample.ports);
      }
    }, abort.signal)
    .catch((err: unknown) => {
      // The seed read's first failure propagates by design, and after this module's
      // total `read` the only way through is the PERMANENT arm. Say so once, at
      // fatal, and stop — never a five-second error loop, and never a sampler that
      // looks armed while it can never answer.
      opts.log.fatal(
        { err },
        "port sampler stopped — this host's listening ports cannot be read",
      );
      sampler.dispose();
    });

  return sampler;
}
