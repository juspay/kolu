/**
 * `buildReServe` — one host's parent-side re-serve of the pulam awareness
 * surface.
 *
 * The browser subscribes to the SAME `terminalWorkspaceSurface` the remote
 * pulam daemon serves; the parent doesn't define a different surface, it
 * implements that surface LOCALLY and bridges every primitive to the remote
 * over the mirror. `implementSurface` fail-fast THROWS at construction on any
 * unimplemented primitive, so every cell / collection / stream / procedure is
 * folded or forwarded here for real — no degraded stub.
 *
 * Two bridging directions, the consume-side dual of the daemon's own
 * `implementSurface` (see `packages/pulam/src/daemon.ts`):
 *
 *   - PUSH (folded by the mirror's SINK): the `version` cell, the `awareness`
 *     collection, and the `activity` stream flow INWARD — the mirror reads the
 *     remote and folds each frame into local state (the `version` store, the
 *     `awareness` cache, the `activity` bus). The browser-facing sources read
 *     that local state. `makeSink()` builds this sink; `pumpRemoteSurface`
 *     (the session loop) re-issues it per (re)spawn, but the SAME `makeSink` is
 *     directly invokable with no client — which is exactly what the hermetic
 *     test drives, with no session.
 *
 *   - PULL / INPUT-PARAM (forwarded via the live holders): the
 *     `subscribeRepoChange` / `subscribeFileChange` streams take a per-repo /
 *     per-file input the parent can't subscribe with one fixed value up front,
 *     so their browser-facing sources forward `liveClient.current.surface
 *     .<stream>(input)` on demand. The `fs.*` / `git.*` procedures are pull
 *     calls, forwarded through `liveProcedures.current`. Both holders are
 *     populated/cleared by `pumpRemoteSurface` around each spawn, so a forward
 *     in the gap between a dropped link and the next spawn fails honestly rather
 *     than relaying into a dead client.
 */

import type { ProcedureForwarders, SurfaceSink } from "@kolu/surface/mirror";
import {
  type CellStore,
  type Channel,
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import type {
  AgentClient,
  LiveSpawnHolder,
  ObservableHolder,
} from "@kolu/surface-nix-host";
import { observableHolder } from "@kolu/surface-nix-host";
import {
  type AwarenessValue,
  DEFAULT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
  type Version,
} from "@kolu/terminal-workspace/surface";
import { implement } from "@orpc/server";
import type { ArivuContract } from "../shared/contract.ts";

export type { ArivuContract };

/** The surface SPEC (the structural twin of the contract) — the type
 *  `SurfaceSink` / `ProcedureForwarders` are generic over. */
type ArivuSpec = (typeof terminalWorkspaceSurface)["spec"];

export interface ReServe {
  /** The flattened oRPC router an `RPCHandler` upgrades the browser onto. Held
   *  `unknown`: the precise `Lazy<Router>` type the flatten yields is one
   *  `RPCHandler` / `directLink` can't accept anyway, so the single documented
   *  cast lands at THAT boundary (`hostEntry`'s `new RPCHandler(router as …)`,
   *  the test's `directLink(router as …)`), not at the flatten. */
  router: unknown;
  /** Build the mirror SINK for ONE freshly-spawned client. `pumpRemoteSurface`
   *  calls this per (re)spawn; the hermetic test calls it directly and drives
   *  `mirrorRemoteSurface` itself. The sink folds only PUSH primitives and never
   *  reads the client (forwarding reaches the live client through `liveClient`),
   *  so it takes no client argument. The first `version` frame is the link-live
   *  handshake — `onFirstVersion` runs there (the session loop wires
   *  `markConnected` into it). */
  makeSink: (onFirstVersion?: () => void) => SurfaceSink<ArivuSpec>;
  /** The live-client holder for forwarding input-param streams. OBSERVABLE —
   *  the forwarders rebind to each successive spawn via `whenChanged()`. */
  liveClient: ObservableHolder<AgentClient<ArivuContract>>;
  /** The live-procedures holder for forwarding `fs.*`/`git.*`. Read on demand
   *  (a procedure call reads `.current` at call time), so a plain holder. */
  liveProcedures: LiveSpawnHolder<ProcedureForwarders<ArivuSpec>>;
}

export interface BuildReServeOptions {
  /** Diagnostic sink. Default no-op. */
  log?: (line: string) => void;
}

/**
 * Build one host's re-serve: the local `implementSurface` fragment, its
 * flattened router, the `makeSink` that folds remote frames inward, and the two
 * live holders the session loop populates for forwarding. Pure construction — no
 * session, no ssh — so it is fully exercisable with an in-process `directLink`
 * client (the hermetic test's whole point).
 */
export function buildReServe(opts: BuildReServeOptions = {}): ReServe {
  const log = opts.log ?? (() => {});

  // ── Local state the browser-facing sources read ──────────────────────────
  // The `version` cell store — seeded with the daemon's compile-time default so
  // a browser that connects before the first remote frame still gets a valid
  // snapshot; overwritten by the mirror's first `version` frame.
  const versionStore: CellStore<Version> = inMemoryStore({
    ...DEFAULT_VERSION,
  });
  // The awareness cache — the R4.8a render payload. The mirror's sink upserts /
  // removes per key; the browser-facing collection reads the whole map.
  const awarenessCache = new Map<TerminalId, AwarenessValue>();
  // A local bus the mirror's `activity` sink republishes each remote frame onto,
  // so the browser-facing `activity` source forwards the same data without
  // re-subscribing to the remote. `activityLatest` caches the most-recent frame
  // the mirror folded so a browser that subscribes mid-stream gets the TRUE live
  // set as its snapshot — NOT the awareness key set (every terminal would falsely
  // paint live). It starts `[]`: until the first real frame, NOTHING is live (the
  // dot is the byte-tap, distinct from a terminal merely existing).
  const activityBus: Channel<TerminalId[]> = inMemoryChannel<TerminalId[]>();
  let activityLatest: TerminalId[] = [];

  // ── The forwarding holders (populated by the session loop per spawn) ──────
  // The live client is OBSERVABLE: its input-param stream forwarders must hold
  // open across remote respawns and rebind to each new spawn, so they await
  // `whenChanged()` (woken by the pump's `onChange`) rather than completing.
  const liveClient = observableHolder<AgentClient<ArivuContract>>();
  // The procedures are read on demand at call time, so a plain holder suffices.
  const liveProcedures: LiveSpawnHolder<ProcedureForwarders<ArivuSpec>> = {
    current: null,
  };

  // ── The local surface implementation ─────────────────────────────────────
  const fragment = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    cells: {
      version: { store: versionStore },
    },
    collections: {
      awareness: {
        readAll: () => awarenessCache,
        // The framework's wrapped upsert/remove call these deps then publish
        // through the keyed channels — the single in-process write seam the
        // mirror's sink drives. The browser can't write here: its contract
        // simply doesn't expose `upsert`/`remove`.
        upsert: (key, value) => {
          awarenessCache.set(key, value);
        },
        remove: (key) => {
          awarenessCache.delete(key);
        },
      },
    },
    streams: {
      // Browser-facing `activity` — yields the parent's current live set on
      // subscribe (snapshot-then-delta, the streaming contract every reconnect
      // relies on), then forwards every frame the mirror republished onto the
      // local bus. The snapshot is `activityLatest` (the last frame the mirror
      // folded, `[]` before any), NOT the awareness key set: the live dot is the
      // byte-tap, so a quiet terminal that merely exists must NOT paint live.
      activity: {
        source: async function* (_input, signal) {
          yield [...activityLatest];
          for await (const frame of activityBus.subscribe(signal)) {
            yield frame;
          }
        },
      },
      // Browser-facing `subscribeRepoChange` — a per-repo watcher the parent
      // can't subscribe up front (the input is the browser's). FORWARD to the
      // live remote via `forwardInputStream`: yield the `{ seq: 0 }` snapshot
      // first (the streaming contract's required leading frame, so a browser that
      // subscribes before the link is live still gets a snapshot), then relay each
      // remote pulse. No live client → the snapshot stands until a spawn populates
      // the holder, at which point the next subscribe forwards for real.
      subscribeRepoChange: {
        source: forwardInputStream(
          liveClient,
          (surface) => surface.subscribeRepoChange,
          { seq: 0 },
          "subscribeRepoChange",
          log,
        ),
      },
      // Browser-facing `subscribeFileChange` — same per-file forward shape.
      subscribeFileChange: {
        source: forwardInputStream(
          liveClient,
          (surface) => surface.subscribeFileChange,
          { seq: 0 },
          "subscribeFileChange",
          log,
        ),
      },
    },
    // The `fs.*`/`git.*` procedures are pure FORWARDS — the parent owns no
    // filesystem, so it relays each to the live remote through the mirror's
    // procedure stubs. No live link → a loud throw (fail-fast: a caught error
    // must surface, never collapse to an empty/default result), surfaced to the
    // browser as the call's rejection.
    procedures: {
      fs: {
        listAll: ({ input }) => liveProcs(liveProcedures).fs.listAll(input),
        readFile: ({ input }) => liveProcs(liveProcedures).fs.readFile(input),
        statFileMtimeMs: ({ input }) =>
          liveProcs(liveProcedures).fs.statFileMtimeMs(input),
      },
      git: {
        getStatus: ({ input }) =>
          liveProcs(liveProcedures).git.getStatus(input),
        getDiff: ({ input }) => liveProcs(liveProcedures).git.getDiff(input),
      },
    },
  });

  // `implementSurface` returns a router FRAGMENT (`{ surface: ... }`). Passed
  // straight to `RPCHandler` it double-prefixes (`surface/surface/...`) and no
  // procedure matches; flatten once via `implement(contract).router({...})` (the
  // same shape drishti's `buildRouter` uses). Held as `unknown` — the precise
  // `Lazy<Router>` type RPCHandler can't accept anyway, so the single documented
  // cast lands at the `RPCHandler`/`directLink` boundary, not here.
  const router: unknown = implement(terminalWorkspaceSurface.contract).router({
    ...fragment.router,
  });

  /**
   * Build the mirror sink for one client. Every PUSH primitive folds here:
   * `version` (the first frame is the link-live handshake → `onFirstVersion`),
   * `awareness` (per-key upsert/remove into the cache), and `activity`
   * (republished onto the local bus). The forwarded primitives
   * (`subscribe*Change`, `fs.*`, `git.*`) are NOT in the sink — they're pulled
   * via the live holders.
   */
  const makeSink = (onFirstVersion?: () => void): SurfaceSink<ArivuSpec> => {
    let firstVersionFrame = true;
    return {
      cells: {
        version: (value) => {
          if (firstVersionFrame) {
            firstVersionFrame = false;
            log("version: first snapshot → link live");
            onFirstVersion?.();
          }
          fragment.ctx.cells.version.set(value);
        },
      },
      collections: {
        awareness: {
          upsert: (key, value) =>
            fragment.ctx.collections.awareness.upsert(key, value),
          remove: (key) => fragment.ctx.collections.awareness.remove(key),
        },
      },
      streams: {
        activity: {
          input: {},
          // Cache the frame as the new snapshot BEFORE publishing, so a browser
          // subscribing immediately after sees this frame as its snapshot rather
          // than a stale one (the publish only reaches already-subscribed
          // consumers; a fresh subscribe reads `activityLatest`).
          onFrame: (frame) => {
            activityLatest = frame;
            activityBus.publish(frame);
          },
        },
      },
    };
  };

  return {
    router,
    makeSink,
    liveClient,
    liveProcedures,
  };
}

/** Read the live procedure forwarders or fail loud. A `fs.*`/`git.*` call with no
 *  live remote is a real fault (the browser thinks it's connected), not a benign
 *  degraded state — surface it. The call site names the procedure path, so the
 *  error stays generic over the namespace. */
function liveProcs(
  holder: LiveSpawnHolder<ProcedureForwarders<ArivuSpec>>,
): ProcedureForwarders<ArivuSpec> {
  const procs = holder.current;
  if (procs === null) {
    throw new Error("procedure forwarded with no live pulam connection");
  }
  return procs;
}

/** A surface stream method as the re-serve forwards it: `.get(input, { signal })`
 *  → an async pulse stream. The one shape the input-param forwarders plug into. */
interface ForwardableStream<I, P> {
  get: (
    input: I,
    opts: { signal: AbortSignal | undefined },
  ) => Promise<AsyncIterable<P>>;
}

/**
 * Build a browser-facing source that forwards an INPUT-PARAMETERIZED stream to
 * the live remote, snapshot-then-relay, staying OPEN across remote respawns. The
 * single encoding of "yield the leading frame, then relay the live remote's
 * pulses, rebinding to each successive live client until the browser unsubscribes"
 * that `subscribeRepoChange` and `subscribeFileChange` both need (and any future
 * per-input stream will too).
 *
 * Why a loop and not a one-shot: the browser↔parent transport does NOT drop when
 * a *remote* link respawns (stdio doesn't recover mid-stream — the pump re-dials
 * and swaps `holder.current`). If this source merely forwarded the current
 * client's stream and returned when it ended, the browser would see a CLEAN
 * end-of-stream (not a transport error), so `STREAM_RETRY` would never re-fire
 * and the watcher would silently go dead. Instead we loop: forward the live
 * client's pulses, and when that spawn's stream ends (or none is up yet), wait on
 * `holder.whenChanged()` for the NEXT live client and rebind — exiting only when
 * the browser aborts. The leading `lead` frame is yielded once up front so a
 * browser that subscribes before the link is live still gets its snapshot.
 *
 * The hold-and-rebind gap policy is deliberately app-local: it's a re-serve
 * convention, not a pump primitive, so it stays here rather than in
 * `pumpRemoteSurface`. It requires an OBSERVABLE holder (`whenChanged`) — the
 * pump fires `onChange` on every set/clear of `.current`, which is what wakes the
 * `whenChanged()` await below.
 */
function forwardInputStream<I, P>(
  holder: ObservableHolder<AgentClient<ArivuContract>>,
  select: (
    surface: AgentClient<ArivuContract>["surface"],
  ) => ForwardableStream<I, P>,
  lead: P,
  label: string,
  log: (line: string) => void,
): (input: I, signal: AbortSignal | undefined) => AsyncGenerator<P> {
  return async function* (input, signal) {
    // `signal?.aborted` read as a fresh boolean each time — a plain `while
    // (signal?.aborted !== true)` would let TS NARROW `.aborted` to `false |
    // undefined` for the body, so the post-`await` re-checks below (the signal
    // can flip mid-await) would be flagged as dead comparisons. The thunk reads
    // the live value with no narrowing.
    const isAborted = (): boolean => signal?.aborted === true;
    yield lead;
    while (!isAborted()) {
      const client = holder.current;
      if (client === null) {
        // No live remote yet (pre-handshake, or between a dropped link and the
        // next spawn). HOLD — don't complete the browser's stream — and wake on
        // the next `.current` change. Reject-on-abort means the browser
        // unsubscribing tears us down cleanly.
        log(`${label}: no live client — holding for next spawn`);
        try {
          await holder.whenChanged(signal);
        } catch {
          return; // aborted: the browser unsubscribed
        }
        continue;
      }
      // Relay this spawn's pulses until ITS stream ends, then loop back to
      // rebind to the next live client. A stdio link drop mid-stream surfaces
      // here as a THROW (the `.get()` rejects, or the `for await` iterator
      // throws on the dropped link) — NOT a clean `return`. Treat that exactly
      // like a clean end: a remote-side blip must NOT kill the browser's
      // subscription, or the watcher silently goes dead until a manual reload.
      // This mirrors `mirrorRemoteSurface`, which logs an upstream stream error
      // and ends the loop rather than propagating it. The ONLY exit is the
      // browser aborting (the `while` guard / the `whenChanged` reject).
      try {
        for await (const pulse of await select(client.surface).get(input, {
          signal,
        })) {
          yield pulse;
        }
        log(`${label}: remote stream ended — awaiting next spawn`);
      } catch (err) {
        // The browser aborting is not an upstream fault — let teardown propagate
        // so the generator stops (and we don't log a phantom "link blip").
        if (isAborted()) return;
        log(
          `${label}: remote stream errored (link blip) — awaiting next spawn: ${(err as Error).message}`,
        );
      }
      // Whether the spawn's stream ended cleanly or blipped, don't busy-loop
      // back onto the SAME just-dead client: wait for the pump to swap in the
      // next one (or clear it). `holder.current` may already hold a fresh client
      // — `whenChanged` would then block until the spawn AFTER it — so re-check
      // first and only wait when nothing new is live.
      if (holder.current === client || holder.current === null) {
        try {
          await holder.whenChanged(signal);
        } catch {
          return; // aborted: the browser unsubscribed
        }
      }
    }
  };
}
