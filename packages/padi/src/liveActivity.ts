/**
 * The LIVE backing for padiSurface's `activity` stream — "which terminals are
 * moving bytes RIGHT NOW". padi taps its kaval's per-terminal byte output (the
 * same delta stream the browser's green dot reads client-side) and folds it into a
 * live SET of terminal ids the stream publishes whole (snapshot-then-deltas).
 *
 * Deferred out of W2.2 (a producer with no consumer) and lit HERE with its first
 * consumer — `padi-tui watch`/`status` — per the self-sufficiency rule. The tap is
 * LAZY: byte taps open per live terminal only WHILE the `activity` stream has a
 * subscriber, and close when the last one leaves, so an UNWATCHED padi pays nothing
 * (an always-on per-terminal byte tap would be continuous work no one reads — a
 * perf anti-pattern). The client green dot is unchanged: it derives from its OWN
 * `terminalAttach` bytes (`useTerminalActivity`), never this surface member.
 *
 * This is the padi-owned twin of the retired `pulam/src/activity.ts` tracker
 * (pulam dies at W2.3); the tracker + `sameActivitySet` are reimplemented here
 * rather than imported from the dying package.
 */

import { pollOnEvent } from "@kolu/surface/server";
import {
  TERMINAL_IDLE_AFTER_MS,
  type TerminalId,
} from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { terminalsDirtyChannel } from "./publisher.ts";
import { registryMap } from "./terminal-registry.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";

/** The `activity` stream backing shape — the live-set `source` thunk padi's
 *  `padiSurface` activity stream is wired with. Re-invoked per subscription
 *  (`(input, signal) => AsyncIterable<TerminalId[]>`), so each subscriber gets
 *  its own tracker + tap set. Spelled locally now that the dead
 *  `terminalWorkspaceSurface` assembler that once named it is gone. */
type ActivityStreamDeps = {
  source: (
    // `undefined` joined the wire shape at padiSurface 4.1: the MCP face reads
    // this no-input stream as a static resource via `.get(undefined)`. The
    // source ignores its input either way.
    input: Record<string, never> | undefined,
    signal: AbortSignal | undefined,
  ) => AsyncIterable<TerminalId[]>;
};

interface ActivityTracker {
  /** Record a chunk of output for `id`: light its live flag (publishing a change
   *  if it was static) and arm/refresh the quiet-period timer. */
  noteOutput(id: TerminalId): void;
  /** Drop a departed (or newly-tapped-then-gone) terminal — clears its timer and
   *  removes it from the live set at once. */
  forget(id: TerminalId): void;
  /** The current live set as a SORTED array — a stable wire frame (so an unordered
   *  Set mutation can't churn the stream with reordered-but-equal frames). */
  snapshot(): TerminalId[];
  /** Subscribe to live-set changes; returns an unsubscribe. */
  onChange(listener: () => void): () => void;
  /** Stop every timer and drop all state. */
  dispose(): void;
}

function createActivityTracker(
  idleAfterMs = TERMINAL_IDLE_AFTER_MS,
): ActivityTracker {
  const live = new Set<TerminalId>();
  const timers = new Map<TerminalId, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };
  return {
    noteOutput(id) {
      if (!live.has(id)) {
        live.add(id);
        notify();
      }
      const pending = timers.get(id);
      if (pending) clearTimeout(pending);
      const timer = setTimeout(() => {
        timers.delete(id);
        if (live.delete(id)) notify();
      }, idleAfterMs);
      // Don't let a pending idle-timer keep the process alive — the serve link does.
      timer.unref?.();
      timers.set(id, timer);
    },
    forget(id) {
      const pending = timers.get(id);
      if (pending) clearTimeout(pending);
      timers.delete(id);
      if (live.delete(id)) notify();
    },
    snapshot() {
      return [...live].sort();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      live.clear();
      listeners.clear();
    },
  };
}

/** Frame equality for the `activity` stream — both come from `snapshot()` so they
 *  are sorted; compare length then element-wise. Lets `pollOnEvent` suppress a
 *  redundant yield when a timer re-arm didn't actually change the live set. */
function sameActivitySet(
  a: readonly TerminalId[],
  b: readonly TerminalId[],
): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The live location a terminal record carries — the arg `resolveTerminalEndpoint`
 *  routes an attach by. Read off the active arm (only active terminals have a live
 *  PTY to tap). */
type TerminalLocation = Parameters<typeof resolveTerminalEndpoint>[0];

/**
 * Build the LIVE `activity` source `buildPadiSurfaceDeps` wires in place of
 * `quietActivity`. The `source` thunk is re-invoked PER SUBSCRIPTION, so each
 * subscriber gets its own tracker + tap set, torn down on its own abort — no
 * shared lifetime to leak. Within a subscription:
 *   - open a byte tap (kaval's `terminalAttach` deltas, via the endpoint) for every
 *     ACTIVE terminal, counting the FACT of each output chunk (never the bytes);
 *   - reconcile that tap set on every `terminals`-dirty pulse (a create / kill /
 *     sleep / wake), so a terminal spawned mid-watch gets tapped and a departed one
 *     is dropped;
 *   - publish the tracker's sorted live set as the stream frame (`pollOnEvent`).
 */
export function createLiveActivitySource(log: Logger): ActivityStreamDeps {
  return {
    // An async generator so teardown rides its `finally` — it fires whether the
    // subscription ends by the framework's abort OR by the consumer stopping
    // iteration (the stream `signal` is `AbortSignal | undefined`, so tying tap
    // teardown to it alone would leak when no signal is passed). A LOCAL abort,
    // chained from the framework signal, drives every child subscription.
    source: (_input, signal) =>
      (async function* activityFrames(): AsyncGenerator<TerminalId[]> {
        const localAbort = new AbortController();
        if (signal !== undefined) {
          if (signal.aborted) localAbort.abort();
          else
            signal.addEventListener("abort", () => localAbort.abort(), {
              once: true,
            });
        }
        const sig = localAbort.signal;
        const tracker = createActivityTracker();
        // One byte-tap AbortController per tapped terminal — aborting it ends that
        // terminal's attach subscription.
        const taps = new Map<TerminalId, AbortController>();

        const openTap = (id: TerminalId, location: TerminalLocation): void => {
          if (taps.has(id) || sig.aborted) return;
          const tapAbort = new AbortController();
          taps.set(id, tapAbort);
          void (async () => {
            try {
              const { deltas } = await resolveTerminalEndpoint(location).attach(
                id,
                tapAbort.signal,
              );
              // Each delta is fresh output — the FACT of bytes, not the bytes. The
              // attach's first frame (the scrollback snapshot) is delivered
              // separately (never through `deltas`), so replayed screen can't
              // false-light it.
              for await (const _chunk of deltas) tracker.noteOutput(id);
            } catch (err) {
              if (!tapAbort.signal.aborted) {
                log.debug({ err, terminal: id }, "activity byte-tap ended");
              }
            } finally {
              // Drop this tap's map entry so a later `reconcile()` can REOPEN it —
              // the attach stream can end (a transient kaval drop) while the
              // terminal stays active, and a stale `taps.has(id)` would then wedge
              // its activity dead for the whole subscription. Guard on identity so a
              // `closeTap` that already replaced/removed this controller (or a
              // reconcile that opened a fresh one for a re-tapped id) is untouched.
              if (taps.get(id) === tapAbort) taps.delete(id);
              tracker.forget(id);
            }
          })();
        };

        const closeTap = (id: TerminalId): void => {
          const a = taps.get(id);
          if (a === undefined) return;
          taps.delete(id);
          a.abort();
          tracker.forget(id);
        };

        // Open a tap for every ACTIVE terminal; close taps for terminals that left.
        const reconcile = (): void => {
          const active = new Map<TerminalId, TerminalLocation>();
          for (const [id, meta] of registryMap((e) => e.meta)) {
            if (meta.state === "active") active.set(id, meta.location);
          }
          for (const [id, loc] of active) openTap(id, loc);
          for (const id of [...taps.keys()]) {
            if (!active.has(id)) closeTap(id);
          }
        };

        reconcile();
        // Re-reconcile on every terminals-dirty pulse until teardown —
        // `subscribe(sig)` ends the loop when `localAbort` fires.
        void (async () => {
          try {
            for await (const _ of terminalsDirtyChannel.subscribe(sig)) {
              reconcile();
            }
          } catch (err) {
            // Teardown (`sig` aborted) is the expected end — the `finally` below
            // tears the taps down, so swallow it. A NON-abort failure (a publisher
            // fault, or a throw out of `reconcile`) would otherwise silently freeze
            // tap reconciliation while the stream keeps publishing stale frames — so
            // surface it loudly rather than letting it vanish in this detached task.
            if (!sig.aborted) {
              log.error({ err }, "activity tap reconcile loop failed");
            }
          }
        })();

        try {
          yield* pollOnEvent<TerminalId[]>({
            read: async () => tracker.snapshot(),
            isEqual: sameActivitySet,
            install: (onEvent) => tracker.onChange(onEvent),
            signal: sig,
            onReadError: () => {},
          });
        } finally {
          localAbort.abort();
          for (const id of [...taps.keys()]) closeTap(id);
          tracker.dispose();
        }
      })(),
  };
}
