/**
 * `watchTerminalAwareness` — the ONE shared per-terminal sensing LEAF, driven by
 * BOTH homes of `@kolu/pulam-library`: the standalone `pulam` daemon (which
 * discovers terminals by polling a dialed kaval) and kolu-server's in-process
 * `LocalTerminalEndpoint` (which drives it from its own spawn/wake/adopt/sleep
 * lifecycle events). Given ONE already-known terminal it wires the volatility that
 * is genuinely shared — "sense this terminal" — and nothing else:
 *
 *   bridgeKavalTaps ─► cwd-persist consumer ─► startAwareness ─► raw-output activity tap
 *
 * It bakes in NONE of the per-home concerns, which differ legitimately and are all
 * INJECTED:
 *   - DISCOVERY — who decides a terminal exists (the daemon polls `terminal.list`;
 *     kolu fires on spawn/wake/adopt). The leaf is handed one `id`.
 *   - the SEEDED RECORD — the home seeds `record.meta` and publishes it BEFORE
 *     calling the leaf (the daemon from `seedAwarenessValue`; kolu from its
 *     RESTORED registry awareness, `getTerminal(id).awareness`). The leaf takes the
 *     already-seeded record and **never re-seeds or over-publishes it** — that is
 *     the fold-clobber fix that killed the first local-pulam cut: a restored cwd /
 *     git / agentSession is preserved because the leaf only ever *reacts to taps*
 *     through the injected sink, never writes a fresh seed.
 *   - the SINK — the daemon injects the library's plain {@link makeAwarenessSink}
 *     (publish the whole value to its served collection); kolu injects its richer
 *     fold sink (the persisted/live fence + `trackRecent`). The leaf only calls the
 *     sink's `updateServer*Metadata`; the fold stays kolu-side.
 *   - the served COLLECTION — the leaf never touches it. Sensor writes reach the
 *     wire through the injected sink; the home owns where that lands.
 *   - the ACTIVITY TRACKER — the home owns one tracker per host and hands the leaf
 *     a per-terminal {@link TerminalActivityTap} bound to this `id`. The leaf's
 *     raw-output tap calls `noteOutput()` per output delta and `forget()` on stop.
 *
 * The EXIT/lifecycle tap is deliberately NOT the leaf's: the daemon learns of a
 * departed terminal by polling, kolu by its own `exit` tap → `handleExit`. The
 * leaf only senses; the home owns start/stop.
 */

import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { type PtyHostClient, ptyHostSurface } from "kaval";
import type { Logger } from "pino";
import { bridgeKavalTaps } from "./kavalChannels.ts";
import type { TerminalId } from "./schema.ts";
import {
  type AwarenessRecord,
  type AwarenessSink,
  startAwareness,
} from "./sensors.ts";

/** A per-terminal activity hook bound to one terminal `id` by the home. The home
 *  owns the (per-host) activity tracker; the leaf only signals output motion
 *  (`noteOutput` per raw-output delta) and departure (`forget` on stop). Kept
 *  id-free so the leaf names no tracker and the home keeps tracker ownership. */
export interface TerminalActivityTap {
  /** A chunk of raw output arrived — light this terminal's live flag. */
  noteOutput(): void;
  /** Sensing stopped — drop this terminal from the live set. */
  forget(): void;
}

export interface WatchTerminalDeps {
  /** The dialed kaval (a `ptyHostSurface` client) the per-terminal taps ride. The
   *  home owns the connection's lifecycle; the leaf only reads it. */
  kaval: PtyHostClient;
  id: TerminalId;
  /** The terminal's awareness record, **already seeded by the home**. The leaf
   *  reads `record.meta` back as the sensors' prior state and never re-seeds it. */
  record: AwarenessRecord;
  /** The home's sink — the leaf calls `updateServer*Metadata`; the persisted/live
   *  fold (if any) lives in the sink, not here. */
  sink: AwarenessSink;
  /** Per-terminal activity hook (see {@link TerminalActivityTap}). */
  activity: TerminalActivityTap;
  log: Logger;
}

/** Start the per-terminal sensor set + tap bridges for one already-seeded
 *  terminal. Returns the teardown (abort the taps, stop the sensors, drop the
 *  terminal from the activity set) — but NOT the kaval connection, which the home
 *  owns. */
export function watchTerminalAwareness(deps: WatchTerminalDeps): () => void {
  const { kaval, id, record, sink, activity, log } = deps;
  const abort = new AbortController();

  const signals = bridgeKavalTaps(kaval, id, abort.signal, log);

  // Persist cwd changes into the published value — a host concern that rides the
  // INJECTED sink (so kolu's `updateServerMetadata` fires `terminals:dirty` for
  // its session autosave; the daemon's plain sink just re-publishes). The channel
  // fans out, so the git sensor still re-resolves off the same `signals.cwd`.
  signals.cwd.consume({
    onEvent: (cwd) =>
      sink.updateServerMetadata(record, (m) => {
        m.cwd = cwd;
      }),
    // The cwd tap can drop (a kaval link blip); surface it rather than freeze the
    // persisted cwd silently — the git sensor still re-resolves off the fanned
    // channel, but the displayed path may go stale until a re-tap.
    onError: (err) =>
      log.error(
        { err, terminal: id },
        "watchTerminalAwareness: cwd-persist tap error",
      ),
  });

  const stopAwareness = startAwareness(record, id, signals, sink, log);

  // Tap raw output to drive the live-activity set (the green dot). We want only
  // the *fact* of new bytes, never the bytes themselves: skip the snapshot frame
  // (the existing screen, not motion) and treat each delta as one pulse. Held for
  // the terminal's lifetime; `abort` tears it down on stop. Drive it through the
  // same `mirrorRemoteSurface` receptacle the sensors' consume side uses, so this
  // tap reuses its subscribe/abort/swallow-AbortError teardown rather than a hand-
  // rolled copy. (The cwd/title/command/foreground taps ride `bridgeKavalTaps`.)
  void mirrorRemoteSurface(
    ptyHostSurface,
    kaval,
    {
      streams: {
        terminalAttach: {
          input: { id },
          onFrame: (msg) => {
            if (msg.kind === "delta") activity.noteOutput();
          },
        },
      },
    },
    {
      signal: abort.signal,
      log: (line) => log.debug({ terminal: id }, line),
    },
  ).done;

  return () => {
    abort.abort();
    stopAwareness();
    activity.forget();
  };
}
