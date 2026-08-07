/**
 * The port scan's CADENCE — a 5-second baseline nudged by terminal output.
 *
 * The baseline alone would mean up to ~5 s between a dev server printing "ready"
 * and its chip appearing, and a pass is cheap enough that the wait is not worth
 * paying. So the signals that already mark "something happened in this terminal" —
 * an output burst, an OSC 633 command mark — trigger an immediate off-schedule pass.
 *
 * **Per-pass cost is measured at the osfacts binary**, not restated here. The
 * bound below needs no figure at all, which is the point of deriving it.
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
 * What is left here is the one policy that is genuinely padi's: the floor on the
 * nudge edge. "How often may this host's output nudge us?" is a domain question the
 * reactor deliberately declines to name, so it is a throttle wrapped around the edge
 * subscription rather than a new knob on the framework.
 *
 * That floor is **DUTY-CYCLE BOUNDED, not fixed** — `clamp(lastPassMs * 20, 1 s,
 * 5 s)`, see {@link nudgeFloorMs}. A fixed floor makes the cost of a pass a property
 * of the PLATFORM instead of the pass: at 1 s a 93 ms darwin pass is ~9% of a core
 * for as long as any terminal streams. Deriving it caps the scan at ~5% of a core by
 * construction, on any platform, with no knob and no platform switch — and a fast
 * pass (linux, a quiet Mac) sits at the 1 s minimum and never engages the bound at
 * all.
 *
 * Note the narrowing the floor still buys: it governs the EDGE only, not the
 * interval — a nudge landing right after a baseline pass may scan again at once,
 * while the unbounded case it exists for (an agent streaming output, nudging every
 * few milliseconds forever) stays bounded to one pass per gap.
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

import { everyMsOr, source } from "@kolu/surface/reactor";
import type {
  PortInfo,
  TerminalId,
  TerminalPorts,
} from "@kolu/terminal-vocab/schema";
import { samePortList } from "@kolu/terminal-vocab/schema";
import { Effect } from "effect";
import type { Logger } from "pino";
import { PortScanError, portScanSupported, scanSubtreePorts } from "./scan.ts";

/** Baseline cadence of the port scan. The same 5 s `memorySampler` uses, for the
 *  same reason: coarse enough to be free, live enough to be worth reading. */
export const PORT_SCAN_INTERVAL_MS = 5_000;

/** Floor between two NUDGED passes, however many nudges arrive — the FAST end of
 *  the duty-cycle bound below, and the only end linux (14-18 ms/pass) or a quiet
 *  Mac ever reaches. */
const PORT_SCAN_MIN_GAP_MS = 1_000;

/** The slow end. Past this the nudge stops being a nudge, so the bound saturates
 *  rather than growing without limit — the 5 s baseline is still running under it. */
const PORT_SCAN_MAX_GAP_MS = 5_000;

/** How many times its own duration a pass must rest before the next NUDGED pass.
 *  20 caps the scan at ~5% of one core in the steady state BY CONSTRUCTION, rather
 *  than by a measurement that can go stale.
 *
 *  A FIXED floor silently converts a slow platform into a hot loop, and that is not
 *  hypothetical: the darwin path measured 93 ms on a busy Mac, which at a 1 s floor
 *  is ~9% of a core for as long as any terminal streams output. Deriving the floor
 *  from the pass makes a slow pass pay for itself in its OWN cadence. No knob, no
 *  platform switch: a fast pass sits at {@link PORT_SCAN_MIN_GAP_MS} and never
 *  notices this exists. */
const PORT_SCAN_DUTY_DIVISOR = 20;

/** The nudge floor a pass of `lastPassMs` earns. Exported for the unit test — the
 *  whole point is which inputs do NOT move it off the minimum. */
export function nudgeFloorMs(lastPassMs: number): number {
  return Math.min(
    PORT_SCAN_MAX_GAP_MS,
    Math.max(PORT_SCAN_MIN_GAP_MS, lastPassMs * PORT_SCAN_DUTY_DIVISOR),
  );
}

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
  /** Something happened in a terminal — look sooner. Floored by
   *  {@link nudgeFloorMs} (≥1 s, stretched for a slow pass), and coalesced by the
   *  poll source: a nudge that
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
): { fire: () => void; cancel: () => void; setGap: (ms: number) => void } {
  let gapMs = minGapMs;
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
      if (since >= gapMs) {
        run();
        return;
      }
      pending = setTimeout(() => {
        pending = undefined;
        run();
      }, gapMs - since);
      pending.unref();
    },
    cancel: () => {
      if (pending !== undefined) clearTimeout(pending);
      pending = undefined;
    },
    // Set per pass rather than fixed at construction, because the gap is DERIVED
    // from how long the last pass took. A trailing call already pending keeps the
    // gap it was scheduled with: re-arming it would let a slow pass postpone a
    // nudge that is already waiting, which is the starvation the floor must not
    // introduce while trying to bound cost.
    setGap: (ms: number) => {
      gapMs = ms;
    },
  };
}

/** Start the port sampler. `targets()` is re-read at the top of EVERY pass — that
 *  is what makes "repartition from the current root pids every tick" true of the
 *  running system rather than only of the scan function: a terminal that closed
 *  between two passes is simply not in the list.
 *
 *  `scan` is injectable so the cadence can be tested without an OS; production
 *  passes the real `scanSubtreePorts`. */
export function createPortSampler(opts: {
  targets: () => readonly PortScanTarget[];
  /** Deliver one terminal's re-sampled port set. Called for EVERY target of the
   *  pass, including those serving nothing — a terminal whose last port died must
   *  hear about the empty set. The consumer owns the structural dedup. */
  publish: (id: TerminalId, ports: TerminalPorts) => void;
  /** The root pid this terminal has RIGHT NOW, or `undefined` if it is gone — the
   *  freshness question, asked per terminal at the publish boundary. Separate from
   *  `targets()` because it is a point lookup the caller can answer from the map it
   *  already keys by id, where `targets()` would rebuild the whole list. */
  rootPidOf: (id: TerminalId) => number | undefined;
  log: Logger;
  scan?: (rootPids: readonly number[]) => Promise<Map<number, PortInfo[]>>;
}): PortSampler {
  // THE reactor-poll Promise edge for this sampler, and its only run. The
  // reactor's `read` dep is `() => Promise<T>` BY DESIGN — a poll source owns
  // its own cadence and seed and is deliberately not Effect code (H1) — so the
  // injectable `scan` seam is Promise-shaped to match the read it feeds, and
  // `scanSubtreePorts` (Effect-native since the client went Effect-native) is
  // run HERE, once, rather than at each of the three places the read uses it.
  // `runPromise` rejects with the failure value itself, so the
  // permanent-vs-transient `instanceof PortScanError` fold in the read below
  // reads exactly what the old rejection handed it.
  const scan =
    opts.scan ?? ((rootPids) => Effect.runPromise(scanSubtreePorts(rootPids)));
  // The permanent refusal, asked BEFORE the cadence exists. Checking it inside the
  // read could not deliver the "say it once, then stop" contract: the first read on
  // a host with no terminals yet answers an empty map without reaching the platform
  // switch, so the refusal would land on a later tick — where the poll source logs
  // and holds, and "stop" quietly becomes an error every 5 s forever.
  //
  // UNCONDITIONAL, including when a `scan` is injected. It used to exempt an
  // injected scan as "a test's own business", and that exemption was the reason the
  // refusal could not be tested at all: a test could not attach a counting scan
  // without also disabling the thing it wanted to observe, so a mutant that logged
  // once and then armed anyway satisfied every assertion.
  if (!portScanSupported()) {
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
  let last = new Map<TerminalId, { rootPid: number; ports: TerminalPorts }>();
  /** The nudge edge, live only while the cadence is installed. */
  let edge:
    | { fire: () => void; cancel: () => void; setGap: (ms: number) => void }
    | undefined;

  /** How long the last COMPLETED pass took, in ms — the duty-cycle floor's only
   *  input. Zero until the first pass finishes, which correctly leaves the first
   *  nudge at the minimum gap: there is no measurement yet to bound anything by. */
  let lastPassMs = 0;

  /** The sampler's teardown latch — the poll connector's abort signal, and the one
   *  thing `dispose()` does. Declared HERE, above the read, because the read's
   *  permanent-failure arm is a caller of it: the stop decision belongs to the pass
   *  that learned the platform can't be read. */
  const abort = new AbortController();

  const node = source<
    ReadonlyMap<TerminalId, { rootPid: number; ports: TerminalPorts }>
  >({
    label: "terminalPorts",
    // TOTAL by the poll source's contract: a transient failure logs and re-serves
    // the last map. A genuinely PERMANENT failure stops the sampler explicitly (it
    // aborts the connector below) — the framework will not stop it for us, at any
    // tick, and that symmetry is deliberate (#2101 G1).
    read: async () => {
      const targets = opts.targets();
      // No terminals, no OS work at all — not even a `/proc` readdir. The interval
      // keeps ticking, so the first terminal of a session is picked up without the
      // sampler needing to be re-armed from outside. Deliberately BEFORE the timing
      // below: a pass that did no work must not teach the floor that work is cheap.
      if (targets.length === 0) return new Map();
      // Timed around the WHOLE pass — the scan AND the join — because the floor
      // bounds what this readout costs the box, and the join is part of that cost.
      const startedAt = Date.now();
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
        // Build each terminal's `TerminalPorts` ONCE and keep it. An unchanged host
        // then republishes the SAME OBJECT, which lets the per-terminal sensor drop
        // it on a pointer compare instead of walking every port — and allocates
        // nothing in the steady state, which is where a 1 Hz sampler spends its life.
        // A port that really moved gets a fresh object, so the gate still sees it.
        const next = new Map<
          TerminalId,
          { rootPid: number; ports: TerminalPorts }
        >();
        for (const t of targets) {
          const list = byPid.get(t.rootPid)!;
          const held = last.get(t.id);
          const ports: TerminalPorts =
            held?.rootPid === t.rootPid &&
            held.ports.status === "known" &&
            samePortList(held.ports.list, list)
              ? held.ports
              : { status: "known", list };
          next.set(t.id, { rootPid: t.rootPid, ports });
        }
        last = next;
        return last;
      } catch (err) {
        // The PERMANENT arm STOPS THE SAMPLER, here, at the pass that learned the
        // truth: a platform this scan cannot read will not become readable in five
        // seconds, so retrying it is a caught error degrading into an error loop
        // instead of surfacing. Say it once, at fatal, abort the cadence, and let
        // the throw unwind — post-abort the poll treats it as an OWNED close, so
        // nothing further is logged and no tick re-arms.
        //
        // The stop is DECIDED HERE rather than by a seed rejection reaching the
        // `.catch` below, and that is the point (juspay/kolu#2101 G1): a poll read's
        // failure is cell-local at every tick, so "propagate and let the connector
        // die" would have worked only on the T+0 pass and looped forever on any
        // later one. A permanent verdict is this module's to act on, at whichever
        // pass produces it.
        if (
          err instanceof PortScanError &&
          err.kind === "unsupported-platform"
        ) {
          opts.log.fatal(
            { err },
            "port sampler stopped — this host's listening ports cannot be read",
          );
          abort.abort();
          throw err;
        }
        // Everything else is THIS pass failing to see (an EACCES on a requested
        // subtree, an lsof that timed out) and must not publish an empty set. A
        // terminal we hold no sample for stays `unknown` on the wire — a real state
        // a consumer reads, not a `[]` that would read as "serves nothing" — so the
        // window needs no second, weaker naming in a log line.
        opts.log.error(
          { err },
          "port scan failed — ports left at their last sample",
        );
        return last;
      } finally {
        // In `finally` so a pass that FAILED still pays for its own cost. That is
        // the case that matters most: a helper that hit the 5 s timeout is the most
        // expensive pass there is, and an error path that skipped this would let it
        // repeat every second.
        lastPassMs = Date.now() - startedAt;
        edge?.setGap(nudgeFloorMs(lastPassMs));
      }
    },
    install: everyMsOr(PORT_SCAN_INTERVAL_MS, (tick) => {
      const floored = flooredEdge(tick, nudgeFloorMs(lastPassMs));
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
      for (const [id, sample] of byTerminal) {
        // A POINT lookup against the caller's own map, rather than rebuilding the
        // whole target list and indexing it again: the question here is "is this one
        // terminal still who it was?", asked at most N times, and the caller already
        // holds a Map keyed by exactly that id.
        if (opts.rootPidOf(id) !== sample.rootPid) continue;
        opts.publish(id, sample.ports);
      }
    }, abort.signal)
    .catch((err: unknown) => {
      // A poll read's failure never lands here any more (#2101 G1: cell-local at
      // every tick, including T+0) — the permanent arm above already logged and
      // stopped, and its post-abort throw is swallowed as an owned close. What CAN
      // land here is the connector's own WIRING failing: an `install` that threw.
      // That is structural, so say it once at fatal and leave the sampler stopped
      // rather than pretending it is armed.
      opts.log.fatal(
        { err },
        "port sampler could not arm its cadence — this host's listening ports will not be read",
      );
      sampler.dispose();
    });

  return sampler;
}
