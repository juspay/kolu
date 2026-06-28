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
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import type {
  AgentClient,
  LiveSpawnHolder,
  ObservableHolder,
} from "@kolu/surface-nix-host";
import { observableHolder, seedConnectionCell } from "@kolu/surface-nix-host";
import type { ConnectionInfo } from "@kolu/surface-nix-host/connection";
import {
  mirrorTerminalWorkspace,
  type TerminalWorkspaceMirror,
} from "@kolu/terminal-workspace/reserve";
import type {
  AwarenessValue,
  TerminalId,
  TerminalWorkspaceSpec,
  Version,
} from "@kolu/terminal-workspace/surface";
import { DEFAULT_VERSION } from "@kolu/terminal-workspace/surface";
import { implement } from "@orpc/server";
import { pulamSurface, type PulamContract } from "../shared/contract.ts";

export type { PulamContract };

/** The surface SPEC (the structural twin of the contract) — the type
 *  `SurfaceSink` / `ProcedureForwarders` are generic over. */
type PulamSpec = TerminalWorkspaceSpec;

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
  makeSink: (onFirstVersion?: () => void) => SurfaceSink<PulamSpec>;
  /** The live-client holder for forwarding input-param streams. OBSERVABLE —
   *  the forwarders rebind to each successive spawn via `whenChanged()`. */
  liveClient: ObservableHolder<AgentClient<PulamContract>>;
  /** The live-procedures holder for forwarding `fs.*`/`git.*`. Read on demand
   *  (a procedure call reads `.current` at call time), so a plain holder. */
  liveProcedures: LiveSpawnHolder<ProcedureForwarders<PulamSpec>>;
  /** Write the browser-facing `connection` cell — the backend↔remote mirror's
   *  health. The host session loop wires this to `session.onState` (via
   *  `pipeSessionStateToCell`), so the browser sees copying → connecting →
   *  connected → disconnected → failed. Distinct from the mirror sink: this is
   *  the SESSION's state, never the daemon's inert stub. */
  setConnection: (info: ConnectionInfo) => void;
  /** Drop the whole remote-derived fold — the pump's `onLinkDown` hook. BOTH
   *  the awareness cache AND the activity live-set are per-host-session local
   *  state, built once and reused across every (re)spawn while each fresh
   *  mirror's per-key/per-frame bookkeeping starts empty; so a row that changed
   *  (`working→idle`) or departed, or a live-set that went quiet, while the link
   *  was down is never reconciled by the next spawn on its own (the mirror's
   *  link-death teardown fires no `onRemove` and no clearing activity frame, and
   *  a departed key is absent from the new snapshot). Clearing on every link
   *  death lets the next spawn rebuild cleanly from the remote's authoritative
   *  snapshot rather than paint a stale row — or a stale live dot — across the
   *  reconnect — a caught link death must surface, never collapse to
   *  retained-but-wrong state (the project's no-fallback convention). Each
   *  awareness removal publishes through the collection's channels and the empty
   *  activity frame publishes on the bus, so a browser subscribed ACROSS the
   *  reconnect sees the stale rows depart and the dots go dark — not just a
   *  fresh-subscribe one. */
  resetRemoteFold: () => void;
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
  // The browser-facing connection-health cell — the gate-closed seed lives in
  // the shared `seedConnectionCell()` (so a re-serve can't supply a
  // connected-by-default store). It is written by `pumpRemoteSurface` off
  // `session.onState` (NOT folded from the mirror — it's the SESSION's state),
  // through the framework-wrapped `setConnection` below.
  const connection = seedConnectionCell();
  // The awareness cache — the R4.8a render payload. The shared mirror fold
  // (R9.0) upserts / removes per key through the fragment's PUBLISHED write
  // below; the browser-facing collection reads the whole map.
  const awarenessCache = new Map<TerminalId, AwarenessValue>();

  // ── The forwarding holders (populated by the session loop per spawn) ──────
  // The live client is OBSERVABLE: its input-param stream forwarders must hold
  // open across remote respawns and rebind to each new spawn, so they await
  // `whenChanged()` (woken by the pump's `onChange`) rather than completing.
  const liveClient = observableHolder<AgentClient<PulamContract>>();
  // The procedures are read on demand at call time, so a plain holder suffices.
  const liveProcedures: LiveSpawnHolder<ProcedureForwarders<PulamSpec>> = {
    current: null,
  };

  // ── The local surface implementation ─────────────────────────────────────
  // Implements the MIRRORED surface (base + the get-only `connection` cell). The
  // base primitives are folded/forwarded from the daemon's surface; `connection`
  // is the seeded local store the session pump writes — so the browser reads the
  // augmented surface while the mirror still tracks the connection-free base.
  //
  // The `version`/`awareness`/`activity` PUSH fold is the SHARED
  // `mirrorTerminalWorkspace` core (R9.0) — kolu-server folds the SAME way. Its
  // awareness target is the fragment's PUBLISHED write and `onVersion` feeds the
  // fragment's version cell; both reference `fragment`, built here. The
  // fragment's `activity` stream in turn reads `mirror.activity`, so the source
  // is forwarded through `activitySource` (assigned just after the mirror) to
  // break that construction cycle without reading the fragment before it exists.
  let activitySource: TerminalWorkspaceMirror["activity"]["source"] | undefined;
  const fragment = implementSurface(pulamSurface, {
    channel: inMemoryChannelByName(),
    cells: {
      version: { store: versionStore },
      connection,
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
      // Browser-facing `activity` — the shared mirror fold's source (snapshot of
      // the current live set on subscribe, then the bus frames). Forwarded
      // through `activitySource` to break the construction cycle: the value is in
      // place before any subscribe, so the guard never fires at runtime.
      activity: {
        source: (input, signal) => {
          if (activitySource === undefined) {
            throw new Error("re-serve activity source read before build");
          }
          return activitySource(input, signal);
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

  // The shared mirror fold, wired to publish through the fragment: each
  // `awareness` frame goes through the fragment's framework-wrapped
  // `upsert`/`remove` (cache write + channel fan-out, so a browser subscribed
  // across the fold sees deltas), and each `version` frame into the fragment's
  // version cell. `onFirstVersion` (the link-live handshake) is wired per-spawn
  // by the session loop through `makeSink`.
  const mirror: TerminalWorkspaceMirror = mirrorTerminalWorkspace({
    awareness: {
      upsert: (key, value) =>
        fragment.ctx.collections.awareness.upsert(key, value),
      remove: (key) => fragment.ctx.collections.awareness.remove(key),
    },
    onVersion: (value) => {
      fragment.ctx.cells.version.set(value);
    },
  });
  activitySource = mirror.activity.source;

  // `implementSurface` returns a router FRAGMENT (`{ surface: ... }`). Passed
  // straight to `RPCHandler` it double-prefixes (`surface/surface/...`) and no
  // procedure matches; flatten once via `implement(contract).router({...})` (the
  // same shape drishti's `buildRouter` uses). Held as `unknown` — the precise
  // `Lazy<Router>` type RPCHandler can't accept anyway, so the single documented
  // cast lands at the `RPCHandler`/`directLink` boundary, not here.
  const router: unknown = implement(pulamSurface.contract).router({
    ...fragment.router,
  });

  // Write the browser-facing connection cell via the framework-wrapped setter
  // (publishes the delta to subscribers + updates the snapshot store), mirroring
  // how the mirror sink writes `version`. The session loop calls this off
  // `session.onState`.
  const setConnection = (info: ConnectionInfo): void => {
    fragment.ctx.cells.connection.set(info);
  };

  return {
    router,
    // The mirror sink folds `version`/`awareness`/`activity`; `onFirstVersion`
    // is the link-live handshake (the session loop wires `markConnected`).
    makeSink: (onFirstVersion) => mirror.sink(onFirstVersion),
    liveClient,
    liveProcedures,
    // The pump's `onLinkDown` — drop the whole remote-derived fold (stale
    // awareness rows AND the pinned activity live-set) so the next spawn rebuilds
    // from the remote's authoritative snapshot. The fold's `remove` runs through
    // the fragment's published write, so a browser subscribed across the
    // reconnect sees the stale rows depart and the live dots go dark.
    resetRemoteFold: () => mirror.reset(),
    setConnection,
  };
}

/** Read the live procedure forwarders or fail loud. A `fs.*`/`git.*` call with no
 *  live remote is a real fault (the browser thinks it's connected), not a benign
 *  degraded state — surface it. The call site names the procedure path, so the
 *  error stays generic over the namespace. */
function liveProcs(
  holder: LiveSpawnHolder<ProcedureForwarders<PulamSpec>>,
): ProcedureForwarders<PulamSpec> {
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
  holder: ObservableHolder<AgentClient<PulamContract>>,
  select: (
    surface: AgentClient<PulamContract>["surface"],
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
