/**
 * The pulam daemon's per-host awareness LOOP — its home-specific discovery, the
 * counterpart to kolu-server's event-driven lifecycle. The daemon owns no PTYs, so
 * it learns which terminals exist by POLLING the dialed kaval's `terminal.list`;
 * kolu-server (the library's other home) instead drives the same leaf from its own
 * spawn / wake / adopt / sleep EVENTS. Both homes converge on the ONE shared
 * sensing primitive — `watchTerminalAwareness` — and differ only here, in HOW a
 * terminal is discovered and what is injected:
 *
 *   - the SEED is the daemon's: a brand-new terminal gets `seedAwarenessValue`,
 *     published into the served collection BEFORE the leaf runs (the leaf never
 *     seeds — it only senses);
 *   - the SINK is the library's plain {@link makeAwarenessSink} (publish the whole
 *     value to the served collection — no persisted/live fold; the daemon is
 *     ephemeral and never reseeds, so it needs none);
 *   - the ACTIVITY tracker is the daemon's (one per host), handed to the leaf as a
 *     per-terminal hook.
 *
 * This is the two-step `serveTerminalWorkspace` + `implementSurface` order made
 * concrete: the daemon builds the served deps, implements the surface, and hands
 * THIS loop the BROADCASTING `awareness` collection (which only exists post-
 * implement) so each terminal's sink publishes onto the wire.
 */

import {
  type ActivityTracker,
  type AwarenessValue,
  makeAwarenessSink,
  seedAwarenessValue,
  type TerminalId,
  watchTerminalAwareness,
} from "@kolu/pulam-library";
import type { PtyHostClient, PtyHostListEntry } from "kaval";
import type { Logger } from "pino";

/** The broadcasting `awareness` collection handle the daemon hands the loop — the
 *  write side of the *implemented* surface, through which each terminal's sink
 *  publishes so the value reaches the wire, not just a backing store. */
export interface AwarenessCollectionCtx {
  upsert(id: TerminalId, value: AwarenessValue): void;
  remove(id: TerminalId): void;
}

export interface AwarenessLoopDeps {
  /** The dialed kaval — the terminal inventory + the per-terminal taps. */
  kaval: PtyHostClient;
  /** The broadcasting awareness collection (post-`implementSurface`). */
  collection: AwarenessCollectionCtx;
  /** The daemon's per-host activity tracker (also the served `activity` source's
   *  backing, via `liveActivity`). The loop feeds it per terminal through the
   *  leaf; the daemon owns its lifecycle (it is disposed by the daemon, not here). */
  activity: ActivityTracker;
  log: Logger;
  /** How often to poll `terminal.list` for new / departed terminals. */
  pollIntervalMs: number;
}

/** Begin watching kaval's terminals: run the initial reconcile (awaited, so a
 *  client dialing right after `onReady` already sees the current terminals), then
 *  poll. Each terminal's sensors publish through `collection`. Returns the teardown
 *  (stop polling, stop every terminal's sensors) — NOT the kaval connection or the
 *  activity tracker, which the daemon owns and disposes itself. */
export async function startAwarenessLoop(
  deps: AwarenessLoopDeps,
): Promise<() => void> {
  const { kaval, collection, activity, log, pollIntervalMs } = deps;

  // Per-terminal leaf teardown, started on first sight, stopped on departure.
  const watched = new Map<TerminalId, () => void>();

  /** Seed + publish ONE terminal's record (the home's job), build the plain sink,
   *  then drive the shared sensing leaf. Returns the leaf's stop fn. */
  const watchOne = (id: TerminalId, entry: PtyHostListEntry): (() => void) => {
    const record = {
      pid: entry.pid,
      meta: seedAwarenessValue(entry.cwd),
      currentAgent: null,
    };
    const sink = makeAwarenessSink({
      record,
      // Shallow-clone on publish: the sensors mutate `record.meta` in place, so the
      // collection must store an independent snapshot per upsert.
      publish: (meta) => collection.upsert(id, { ...meta }),
      readScreenText: async (tailLines) =>
        (
          await kaval.surface.terminal.getScreenText({
            id,
            extent: { kind: "tail", lines: tailLines },
          })
        ).text,
    });
    // Seed the collection immediately so a subscriber sees the terminal before any
    // tap fires — the daemon's publish, NOT the leaf's (the leaf never seeds).
    collection.upsert(id, { ...record.meta });
    return watchTerminalAwareness({
      kaval,
      id,
      record,
      sink,
      activity: {
        noteOutput: () => activity.noteOutput(id),
        forget: () => activity.forget(id),
      },
      log,
    });
  };

  const reconcile = async (): Promise<void> => {
    let entries: PtyHostListEntry[];
    try {
      ({ entries } = await kaval.surface.terminal.list({}));
    } catch (err) {
      log.error(
        { err },
        "pulam: kaval terminal.list failed; retrying next tick",
      );
      return;
    }
    const live = new Set<TerminalId>();
    for (const entry of entries) {
      live.add(entry.id);
      if (!watched.has(entry.id)) {
        log.debug({ terminal: entry.id }, "pulam: watching terminal");
        watched.set(entry.id, watchOne(entry.id, entry));
      }
    }
    for (const [id, stop] of [...watched]) {
      if (live.has(id)) continue;
      log.debug({ terminal: id }, "pulam: terminal departed");
      stop();
      watched.delete(id);
      collection.remove(id);
    }
  };

  await reconcile();
  const pollTimer = setInterval(() => {
    void reconcile();
  }, pollIntervalMs);
  // Don't let the poll keep the loop alive on its own — the serve link does.
  pollTimer.unref?.();

  return () => {
    clearInterval(pollTimer);
    for (const stop of watched.values()) stop();
    watched.clear();
  };
}
