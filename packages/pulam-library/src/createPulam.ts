/**
 * `createPulam` — the ONE assembly that turns a dialed kaval into a live, served
 * `terminalWorkspace` surface. It is the per-terminal twin of
 * {@link serveTerminalWorkspace}: where that factory assembles the served-surface
 * *skeleton* (version cell + fs/git + the awareness/activity backing seams),
 * `createPulam` assembles the per-terminal *sensor lifecycle* behind it — seed →
 * sink → tap-bridge → sensors → cwd-persist → activity tap → reconcile — and owns
 * the live `activity` tracker.
 *
 * Today it encapsulates the **daemon's** assembly — ONE consumer:
 *   - the `pulam` **daemon** (`packages/pulam`) rests on it — dial a kaval,
 *     `createPulam`, serve the result over a unix socket (or stdio, for ssh).
 *
 * kolu-server still hand-rolls its own assembler in-process (its richer
 * persisted/live sink fold + `trackRecent`); it converges on `createPulam` in
 * **R9.0**, dialing its own kaval client and injecting its registry as the
 * awareness write target. That cutover is what cuts the cross-home seam — the
 * sink fold + the record source — once `createPulam` grows a sink-injection seam
 * to carry kolu's richer sink. Until then `createPulam` is the daemon's private
 * assembly, not yet a two-home receptacle.
 *
 * The home injects the awareness **write target** (`awareness`, the same
 * `AwarenessCollectionDeps` shape `serveTerminalWorkspace` already takes — an
 * owned store for the daemon, a registry projection for kolu) and, once it has
 * implemented the surface, hands back the *broadcasting* collection handle via
 * {@link Pulam.start} so the sink can publish through the wire. That two-step is
 * the one seam worth a sentence: the sink must publish through the framework's
 * broadcasting `ctx.collections.awareness`, which only exists AFTER the home calls
 * `implementSurface(...)` — and that needs {@link Pulam.served} first — so
 * `createPulam` returns `served`, the home implements, the home hands the
 * broadcasting handle to `start`.
 */

import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { pollOnEvent } from "@kolu/surface/server";
import {
  type PtyHostClient,
  type PtyHostListEntry,
  ptyHostSurface,
} from "kaval";
import type { Logger } from "pino";
import { createActivityTracker, sameActivitySet } from "./activity.ts";
import { makeAwarenessSink } from "./awarenessSink.ts";
import type { TerminalWorkspaceEndpoint } from "./endpoint.ts";
import { bridgeKavalTaps } from "./kavalChannels.ts";
import {
  type AwarenessValue,
  seedAwarenessValue,
  type TerminalId,
} from "./schema.ts";
import { type AwarenessRecord, startAwareness } from "./sensors.ts";
import {
  type AwarenessCollectionDeps,
  serveTerminalWorkspace,
} from "./serveTerminalWorkspace.ts";

const DEFAULT_POLL_MS = 1000;

export interface PulamDeps {
  /** The dialed kaval (a `ptyHostSurface` client) — the source of the terminal
   *  inventory + the per-terminal taps. The home owns the connection's lifecycle;
   *  `createPulam` only reads it. */
  kaval: PtyHostClient;
  /** The awareness collection's read/write backing — the sink's write target,
   *  injected by the home (the daemon's own store, kolu's registry projection).
   *  The same shape `serveTerminalWorkspace` takes. */
  awareness: AwarenessCollectionDeps;
  /** The host-side fs/git endpoint served beside awareness (R6). */
  endpoint: TerminalWorkspaceEndpoint;
  log: Logger;
  /** How often to poll kaval's `terminal.list` for new / departed terminals.
   *  Default 1000ms. */
  pollIntervalMs?: number;
}

/** The broadcasting awareness-collection handle a home hands back to
 *  {@link Pulam.start} — the write side of the *implemented* surface (kolu via its
 *  merged ctx, the daemon inline), through which each sink publishes so the value
 *  reaches the wire, not just the backing store. */
export interface AwarenessCollectionCtx {
  upsert(id: TerminalId, value: AwarenessValue): void;
  remove(id: TerminalId): void;
}

export interface Pulam {
  /** The assembled `terminalWorkspace` server deps (minus `channel`) — spread
   *  into `implementSurface(...)` (the daemon) or merged into the home's
   *  multi-surface implement (kolu). */
  served: ReturnType<typeof serveTerminalWorkspace>;
  /** Whether {@link start} has run. The serving home asserts this on its serve
   *  path so a "served but never started" surface — a permanently-empty awareness
   *  collection + a dead activity stream — fails loud instead of passing silently
   *  (the two-step is required, so it cannot be made structurally impossible; this
   *  makes it loud). */
  isStarted(): boolean;
  /** Begin watching kaval's terminals: run the initial reconcile, then poll. Each
   *  terminal's sensors publish through `collection`. Returns the teardown (stop
   *  polling, stop every terminal's sensors, dispose the activity tracker) — but
   *  NOT the kaval connection, which the home owns and disposes itself. **Throws if
   *  called twice** — a pulam watches its kaval exactly once. */
  start(collection: AwarenessCollectionCtx): Promise<() => void>;
}

export function createPulam(deps: PulamDeps): Pulam {
  const { kaval, awareness, endpoint, log } = deps;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_MS;

  // ── Live-output activity — the set of terminals moving bytes right now, fed
  //    from kaval's raw output tap (in `watchTerminal`) and served as the
  //    `activity` stream (snapshot-then-deltas, the whole live set per frame). The
  //    flow primitive beside the stateful collection + cell. ──
  const activity = createActivityTracker();

  // `start()` flips this. The two-step (build `served` → implement the surface →
  // `start`) is genuinely required — the broadcasting collection handle `start`
  // needs only exists *after* `implementSurface(...)`, which itself needs `served`
  // first — so the order can't be collapsed. But that lets a home construct +
  // serve and forget `start()`, leaving awareness permanently empty and activity
  // dead. The guards below make BOTH that broken state and a double-`start` LOUD
  // rather than silent: the activity source refuses to be subscribed before
  // `start`, and the home asserts `isStarted()` on its serve path.
  let started = false;

  // ── The served surface — awareness collection + version cell + activity, plus
  //    the fs/git procedures + watcher streams (R6) — assembled by the ONE shared
  //    `serveTerminalWorkspace` factory. We inject the home's awareness backing and
  //    a LIVE `activity` source over our tracker. ──
  const served = serveTerminalWorkspace({
    awareness,
    // Poll-on-event over the live set: yield the current set, then re-yield
    // whenever a terminal lights up or goes quiet. `sameActivitySet` suppresses
    // the redundant yield when a timer re-arm left the set unchanged.
    activity: {
      source: (_input, signal) => {
        // Subscribed before `start()` ⇒ the surface was served without starting:
        // nothing feeds the tracker, so this stream would sit dead-empty forever.
        // Fail loud (fail-fast: a broken state must not pass silently). After
        // `start()` this never trips — clients subscribe over the wire post-serve,
        // and the daemon awaits `start()` before it serves.
        if (!started)
          throw new Error(
            "createPulam: activity subscribed before start() — the surface was served without start(); call start() after implementing the surface.",
          );
        return pollOnEvent({
          read: async () => activity.snapshot(),
          isEqual: sameActivitySet,
          install: (onEvent) => activity.onChange(onEvent),
          signal,
          // `activity.snapshot()` is a pure in-memory sort over the live Set —
          // it touches no I/O, so it cannot fail: `onReadError` is unreachable,
          // intentionally empty (not a swallowed error). Mirrors `quietActivity`.
          onReadError: () => {},
        });
      },
    },
    endpoint,
    log,
  });

  const start = async (
    collection: AwarenessCollectionCtx,
  ): Promise<() => void> => {
    // Once-guard: a pulam watches its one kaval exactly once. A second start would
    // run a second poll loop and a second per-terminal sensor set feeding the one
    // shared activity tracker — double-watch. Make it unspellable (fail-fast):
    if (started)
      throw new Error(
        "createPulam: start() called twice — a pulam watches its kaval once; create a second pulam for a second kaval.",
      );
    started = true;

    // ── Per-terminal sensors, started on first sight, stopped on departure ──
    const watched = new Map<TerminalId, () => void>();

    /** Start the awareness sensor set for one terminal, publishing each update
     *  into the collection. Returns a stop fn (sensors + tap bridge). */
    const watchTerminal = (
      id: TerminalId,
      entry: PtyHostListEntry,
    ): (() => void) => {
      const abort = new AbortController();
      const record: AwarenessRecord = {
        pid: entry.pid,
        meta: seedAwarenessValue(entry.cwd),
        currentAgent: null,
      };
      // Shallow-clone on publish: the sensors mutate `record.meta` in place (each
      // mutator replaces a whole field), so the collection must store an
      // independent snapshot per upsert rather than alias the live record.
      const publish = (meta: AwarenessValue): void =>
        collection.upsert(id, { ...meta });
      const sink = makeAwarenessSink({
        record,
        publish,
        readScreenText: async (tailLines) =>
          (
            await kaval.surface.terminal.getScreenText({
              id,
              extent: { kind: "tail", lines: tailLines },
            })
          ).text,
      });
      // Seed the collection immediately so a subscriber sees the terminal before
      // any tap fires.
      publish(record.meta);

      const signals = bridgeKavalTaps(kaval, id, abort.signal, log);
      // Persist cwd changes into the published value — a host concern, mirroring
      // kolu-server's local endpoint (whose cwd bridge writes `m.cwd`). The
      // channel fans out, so the git sensor still re-resolves off the same taps.
      signals.cwd.consume({
        onEvent: (cwd) =>
          sink.updateServerMetadata(record, (m) => {
            m.cwd = cwd;
          }),
        // The cwd tap can drop (kaval link blip); surface it rather than freeze
        // the persisted cwd silently — the git sensor still re-resolves off the
        // fanned channel, but the displayed path may go stale until a re-tap.
        onError: (err) =>
          log.error({ err, terminal: id }, "pulam: cwd-persist tap error"),
      });
      const stopAwareness = startAwareness(record, id, signals, sink, log);

      // Tap raw output to drive the live-activity set (the green dot). We want only
      // the *fact* of new bytes, never the bytes themselves: skip the snapshot frame
      // (the existing screen, not motion) and treat each delta as one pulse. Held
      // for the terminal's lifetime; `abort` tears it down on departure. Drive it
      // through the same `mirrorRemoteSurface` receptacle the consume side uses, so
      // this tap reuses its subscribe/abort/swallow-AbortError teardown rather than a
      // third hand-rolled copy. (The other per-terminal taps — cwd/title/command/
      // foreground — still ride `bridgeKavalTaps`'s `bridgeStream`.)
      void mirrorRemoteSurface(
        ptyHostSurface,
        kaval,
        {
          streams: {
            terminalAttach: {
              input: { id },
              onFrame: (msg) => {
                if (msg.kind === "delta") activity.noteOutput(id);
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
        activity.forget(id);
      };
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
          watched.set(entry.id, watchTerminal(entry.id, entry));
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
      activity.dispose();
    };
  };

  return { served, isStarted: () => started, start };
}
