/**
 * `reServeSurface` — re-serve a remote agent's surface downstream, per its
 * declared forwarding policy, with per-binding scope.
 *
 * A re-serving PARENT (kolu-server fronting a padi; drishti fronting its agent)
 * dials one remote agent over a {@link HostSession} and re-serves that agent's
 * surface to its own downstream clients (a browser, a TUI). This assembles the
 * whole re-serve from parts the shared stack already owns — the reconnect-mirror
 * loop ({@link pumpRemoteSurface}) and `implementSurface` — and routes EACH member
 * by the surface's forwarding policy ({@link RelayPolicy},
 * W1's per-member classification):
 *
 *   - **cells** + **collections** (always `value`) — folded into per-binding
 *     stores by the mirror sink, held across an upstream drop and REPLAYED on the
 *     next spawn (a rebind re-seeds the store; a collection's carry-over keys are
 *     reconciled on the fresh snapshot, so a key that departed while down is
 *     dropped without an empty flash). A cell READS from the mirror; a cell WRITE
 *     is FORWARDED to the live agent (via the framework's cell `forward` seam) and
 *     echoes back through the fold — the local store stays a pure read mirror.
 *   - **value streams / events** — held open per downstream subscriber
 *     ({@link relayHoldOpenStream}), rebinding across respawns.
 *   - **delta streams** (byte / liveness) — failed through per subscriber
 *     ({@link relayFailThroughStream}): an upstream drop ends the downstream
 *     stream so the client re-subscribes end-to-end and a snapshot only ever
 *     leads a FRESH stream.
 *   - **procedures** — forwarded to the live spawn's stubs; a call while the link
 *     is down throws loudly (fail-fast), never a silent no-op.
 *
 * The assembly routes each member by reading `policy[member]` at RUNTIME
 * (`requirePolicy`), because the member keys come from `Object.keys(spec.*)` as
 * `string` — no compile-time member literal to guard on here. The COMPILE guard
 * (holding open a byte stream is a type error) lives on the direct-use relays
 * {@link relayHoldOpenStream} / {@link relayFailThroughStream} and is pinned by
 * relayStream.test's `_typeGuards`; the runtime `requirePolicy` is the assembly's
 * equivalent, and W1's set-equality contract test pins which members are `delta`.
 *
 * **Per-binding scope (item 3).** Each `reServeSurface` call mints its OWN store
 * set + router, so a parent that fronts N hosts calls it once per host (through
 * the existing `buildRemotePool.buildEntry`, keyed by the connection's declared
 * host) — one mirror-store set per bound host, shared by every connection
 * watching that host, replacing the single module-level router+store kolu-server
 * wires today. There is no global router here to switch.
 *
 * SELF-CONTAINED at W2.1: its consumers are its own tests plus the paired drishti
 * run. kolu-server binds it at W2.2.
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import type { ProcedureForwarders, SurfaceSink } from "@kolu/surface/mirror";
import type { SurfaceClientLike } from "@kolu/surface/project";
import {
  type CellCtxSetOpts,
  type ImplementSurfaceDeps,
  implementSurfaceOnPublisher,
  inMemoryChannelByName,
  inMemoryCollection,
  superviseTerminalSource,
} from "@kolu/surface/server";
import {
  type LiveSpawnHolder,
  observableHolder,
  pumpRemoteSurface,
} from "./hostFanout";
import {
  type ForwardableStream,
  failThroughStreamCore,
  holdOpenStreamCore,
  type RelayPolicy,
} from "./relayStream";
import type { Session } from "./session";
import type { SshProv } from "./sshConnector";

/** A mirrored cell's local READ store, with the mirror-never-fabricate gate.
 *  Seeds the declared default so `get()` is a typed `T`, and flips `hasSnapshot`
 *  true on the first write — which, on a mirror, only ever comes from the fold
 *  (`ctx.cells.<key>.set` in `makeSink`). The framework's `get` withholds the
 *  seeded default until `hasSnapshot()` is true, so the mirror serves no frame
 *  until the authority's first real one. */
function mirrorReadStore(initial: unknown): {
  get: () => unknown;
  set: (v: unknown) => void;
  hasSnapshot: () => boolean;
} {
  let value = initial;
  let primed = false;
  return {
    get: () => value,
    set: (v) => {
      value = v;
      primed = true;
    },
    hasSnapshot: () => primed,
  };
}

export interface ReServeSurfaceOptions<S extends SurfaceSpec> {
  /** The surface the remote agent serves and this parent re-serves. */
  source: Surface<S>;
  /** The forwarding policy for the surface's input-keyed STREAMING members
   *  (streams + events) — each classified `value` (hold open across an upstream
   *  respawn) or `delta` (fail through, ending the downstream on a drop). This is a
   *  streaming-SURVIVAL axis, not a whole-surface checklist: cells and collections
   *  are always folded as values and procedures are always forwarded, so a policy
   *  entry for one of those kinds is inert. A surface's authored policy (e.g.
   *  padi's `PADI_FORWARDING_POLICY`) satisfies this; the re-serve reads the SAME
   *  classification W1 pinned. Every stream / event must be classified or the
   *  assembly fails loud (no silent-skip default). */
  policy: RelayPolicy;
  /** The long-lived session whose successive spawns are mirrored. Typed to the
   *  loose {@link Session} ROLE. `Prov = SshProv` (the ssh connector's provisioning
   *  vocabulary) so an ssh session and a `never` endpoint (`never extends SshProv`)
   *  both plug in. The mirror
   *  forwards the client structurally, so the contract type is not needed here. */
  session: Session<SurfaceClientLike, SshProv>;
  /** Diagnostic sink. Default no-op. */
  log?: (line: string) => void;
}

export interface ReServedSurface<S extends SurfaceSpec> {
  /** The re-served surface — the agent's base surface, served verbatim. SR9 removed the
   *  per-host `connection` health cell: link health now rides the host-map entry's fine
   *  `connection` payload (the ONE authority), not a second cell on this surface. */
  surface: Surface<S>;
  /** The per-binding oRPC router (flattened for a handler / `directLink`). */
  router: unknown;
  /** Settles when the pump loop exits (the session was destroyed, or `close`
   *  aborted it). It can also REJECT on an unrecoverable mirror fault — a
   *  `SinkError` (a broken local fold), a client/surface mismatch, or an owned
   *  runtime fault (a cell connector rejecting) — which STOPS the pump (no
   *  further reconnect). A consumer MUST observe `done` and surface such a fault
   *  loudly (e.g. via its own error surface / the host-map entry's connection payload);
   *  dropping it leaks a silently-dead binding. (#1661 candidate 9; consumer wiring is W2.2.) */
  done: Promise<void>;
  /** Stop this re-serve: abort the pump (WITHOUT destroying the caller-owned
   *  session — the active mirror's per-key pumps settle via `signal.reason`,
   *  #1719) and release the internal runtime's owned sources. Idempotent; always
   *  resolves. The supervised-teardown twin of `done` (SRT-PR1). */
  close(): Promise<void>;
}

/** The runtime shape of a forwarding stub — loosely typed here; the precise
 *  per-verb type lives at the `ProcedureForwarders<S>` boundary the pump sets. */
type ProcedureFn = (
  input?: unknown,
  opts?: { signal?: AbortSignal },
) => Promise<unknown>;

/** Reach one member namespace on the opaque oRPC surface client structurally —
 *  `client.surface.<member>`. The live client is a lazy proxy with no static member
 *  types at this seam (the precise per-member client is materialized once at the
 *  typed sink, and re-spelling it here would overflow TS's union budget). So the
 *  ONE structural cast lives here, with the ONE justification, instead of restated
 *  at every relay / forward site (SR5). The caller pins the shape it expects via `T`
 *  (a stream, a cell's verb namespace); a member the client doesn't expose reads
 *  `undefined` and each caller fails loud on that. */
function surfaceMember<T>(client: SurfaceClientLike, member: string): T {
  return (client as unknown as { surface: Record<string, T> }).surface[
    member
  ] as T;
}

/** High-water mark for each downstream subscriber's per-cell/-collection receive
 *  queue (see the `channel` factory below). Generous enough that only a
 *  pathologically-behind consumer trips the drop-oldest eviction. */
const RESERVE_CHANNEL_HIGH_WATER_MARK = 4096;

export function reServeSurface<S extends SurfaceSpec>(
  opts: ReServeSurfaceOptions<S>,
): ReServedSurface<S> {
  const log = opts.log ?? (() => {});
  const { source, policy, session } = opts;
  const spec = source.spec;
  // The downstream surface = the agent's base surface, served verbatim (SR9: no
  // `connection` cell composed here — link health rides the host-map entry).
  const surface = source;

  // A source surface must declare at least one CELL. `markConnected` (below) fires
  // on the first folded value of EITHER kind (a cell frame OR a collection upsert),
  // but a CELL is the required backstop: a cell always emits a snapshot on connect,
  // whereas a collection may be empty on connect (no upsert → `markConnected` would
  // never fire). A cell also keeps the mirror alive (a foldless mirror would settle
  // instantly and clear `liveClient`). So a cell-less surface would never mark
  // connected → the connection gate stays closed and the connect watchdog cycles
  // the link to failed. Fail loud at build. (#1661 candidate 7.)
  if (Object.keys(spec.cells ?? {}).length === 0) {
    throw new Error(
      "reServeSurface: source surface declares no cells — markConnected is wired to the first folded cell frame (a cell's on-connect snapshot), so a cell-less surface would never mark the session connected. Add a status cell.",
    );
  }

  // ONE channel factory, shared by `implementSurface` (the deps below) AND the cell
  // fold (which publishes onto the same `<key>:changed` channel a cell's `get`
  // subscribes) — `inMemoryChannelByName` returns the same instance per name.
  //
  // The factory BOUNDS each downstream subscriber's per-cell/-collection receive
  // queue (#1661 candidate h2): a slow browser + a fast mirror fold would otherwise
  // grow the queue without limit. At the bound the OLDEST queued frame is EVICTED
  // (`drop-oldest`) to admit the newest, and `onOverflow` LOGS the drop so it's
  // observable, never silent. This is correct precisely BECAUSE these are VALUE
  // channels (cells + collections, snapshot-then-delta): a dropped intermediate
  // frame is harmless — the next snapshot/delta re-converges the mirror to the
  // authoritative state, so the consumer self-heals in place with the stream still
  // flowing. An `abort` here would be WRONG: it surfaces to the browser as a
  // non-retriable ORPCError, which would STRAND the mirror (it never self-heals)
  // instead of recovering. Fail-fast/abort is the right policy for a byte or
  // fail-through stream (a lost frame is a real gap), NOT for a re-converging value
  // channel — see `relayFailThroughStream`. Only the channeled members (cells +
  // collections, all `value`) ride this; the streaming members (delta byte streams,
  // value pulses) are relayed per-subscriber and backpressured by async-generator
  // suspension, so they never queue here.
  const channel = inMemoryChannelByName({
    highWaterMark: RESERVE_CHANNEL_HIGH_WATER_MARK,
    overflow: "drop-oldest",
    onOverflow: () =>
      log(
        "reServeSurface: a mirrored value channel's downstream receive queue overflowed — dropped the oldest frame (harmless: the next snapshot/delta re-converges the mirror)",
      ),
  });

  // Live-spawn holders the pump drives; the relays read `liveClient` and the
  // procedure forwarders read `liveProcedures`. `observableHolder` gives the
  // hold-open relays a `whenChanged` to rebind on.
  const liveClient = observableHolder<SurfaceClientLike>();
  const liveProcedures: LiveSpawnHolder<ProcedureForwarders<S>> = {
    current: null,
  };

  // Per-binding folded state — the cell stores + collection caches built into the
  // deps below are minted ONCE per reServeSurface call, shared by every downstream
  // connection to this router (item 3: per-binding, not one global). The data
  // members the sink mirrors are exactly `spec.cells` / `spec.collections`.

  const requirePolicy = (member: string): "value" | "delta" => {
    const p = policy[member];
    if (p !== "value" && p !== "delta") {
      throw new Error(
        `reServeSurface: member "${member}" has no forwarding policy — every member must be classified "value" | "delta"`,
      );
    }
    return p;
  };

  // ── implementSurface deps, derived from the policy ────────────────────────

  // Cells — the re-serve is a READ mirror with WRITE-FORWARDING (#1661 candidate 8,
  // closed at W2.2). A downstream READ folds the agent's frames from a local mirror
  // store; a downstream WRITE (set / patch / test__set) is FORWARDED to the live
  // agent — mirroring how PROCEDURES forward through `liveProcedures` — via the
  // framework's cell `forward` seam, NOT applied to the local store. The agent's own
  // write echoes back through the mirror fold (the `<key>:changed` channel), so the
  // local store stays a PURE READ mirror: written ONLY by the fold
  // (`ctx.cells.<key>.set`, see `makeSink`), never by a wire write.
  //
  // The forward deliberately BYPASSES the framework's local `equals` dedup and
  // `bus.publish` — the agent is the authority, so (h3) a wire write whose value
  // equals the STALE local mirror must STILL cross (never dedup-dropped before it
  // reaches the agent), and the mirror must not phantom-echo a value the agent
  // hasn't confirmed (a rejected agent write would otherwise strand it). `equals`
  // is thus left to guard only the FOLD's publish (`ctx.cells.<key>.set`), not the
  // forward. A forward with no live upstream link throws loud (fail-fast), same
  // stance as `forwardProcedure`.
  const forwardCellWrite = (
    key: string,
    verb: "set" | "patch" | "test__set",
    input: unknown,
  ): Promise<unknown> => {
    const client = liveClient.current;
    if (client === null) {
      throw new Error(
        `reServeSurface: cell "${key}.${verb}" written with no live upstream link`,
      );
    }
    const cellNs = surfaceMember<Record<string, ProcedureFn> | undefined>(
      client,
      key,
    );
    const fn = cellNs?.[verb];
    if (typeof fn !== "function") {
      throw new Error(
        `reServeSurface: live upstream client exposes no "${key}.${verb}" cell verb to forward to`,
      );
    }
    return fn(input);
  };
  const cellsDeps: Record<string, unknown> = {};
  for (const [key, cellSpec] of Object.entries(spec.cells ?? {})) {
    // A mirror never fabricates a value. The store still SEEDS the declared
    // default (so `store.get()` is a typed `T`), but `hasSnapshot` stays false
    // until the fold writes the authority's first real frame — the framework
    // withholds the seeded default until then, so a re-served cell serves no
    // frame until the authority speaks. The declared default belongs to the ONE
    // writer, not to a mirror relaying a guess.
    const store = mirrorReadStore((cellSpec as { default: unknown }).default);
    cellsDeps[key] = {
      // The local READ mirror — written ONLY by the fold (`ctx.cells.<key>.set`,
      // see `makeSink`), read by the framework's `get` handler.
      store,
      hasSnapshot: store.hasSnapshot,
      forward: {
        set: (input: unknown) => forwardCellWrite(key, "set", input),
        patch: (input: unknown) => forwardCellWrite(key, "patch", input),
        test__set: (input: unknown) =>
          forwardCellWrite(key, "test__set", input),
      },
    };
  }

  // Collections (always folded as value) → per-key caches the mirror sink folds into.
  // Each cache is kept per key so the sink can hand the mirror its carry-over keys
  // (`initialKeys`) on reconnect — the fresh snapshot then prunes keys that departed
  // while the link was down (no stale ghost rows, no empty flash). (#1661 candidate 1.)
  const collectionCaches = new Map<string, Map<unknown, unknown>>();
  const collectionsDeps: Record<string, unknown> = {};
  for (const key of Object.keys(spec.collections ?? {})) {
    // The additive in-memory Collection shape — one framework implementation
    // (`inMemoryCollection`) rather than the three hand-rolled lines (SR5). The
    // sink hands the live backing Map's keys to the mirror as its carry-over
    // (`initialKeys`), so hold the Map itself for `collectionCaches`.
    const coll = inMemoryCollection<unknown, unknown>();
    collectionCaches.set(key, coll.readAll());
    collectionsDeps[key] = coll;
  }

  // Streams + events → per-subscriber relays, chosen by policy. `select` reaches
  // the live client's own member (`client.surface.<key>`); the relay reads
  // `liveClient` for the current spawn.
  const relayForMember = (
    member: string,
  ): ((
    input: unknown,
    signal: AbortSignal | undefined,
  ) => AsyncIterable<unknown>) => {
    // The live client is an opaque oRPC proxy; reach its member namespace
    // structurally (`client.surface.<member>`), the shape every relay reads.
    const select = (
      client: SurfaceClientLike,
    ): ForwardableStream<unknown, unknown> =>
      surfaceMember<ForwardableStream<unknown, unknown>>(client, member);
    // Route by policy at runtime; the two cores are the impls behind the
    // type-guarded public relays (a widened policy can't satisfy those guards
    // here — the guards are for direct callers + the contract test).
    return requirePolicy(member) === "value"
      ? holdOpenStreamCore(member, liveClient, select, { log })
      : failThroughStreamCore(member, liveClient, select, { log });
  };
  // Streams and events route identically (both per-subscriber relays via
  // `relayForMember`), so build both dep maps from one pass.
  const buildRelayDeps = (
    members: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    const deps: Record<string, unknown> = {};
    for (const key of Object.keys(members ?? {}))
      deps[key] = { source: relayForMember(key) };
    return deps;
  };
  const streamsDeps = buildRelayDeps(spec.streams);
  const eventsDeps = buildRelayDeps(spec.events);

  // Procedures → forward every verb through the live spawn's stubs. A call while
  // the link is down throws loudly (fail-fast); the client retries.
  const forwardProcedure = (
    ns: string,
    verb: string,
    input: unknown,
    signal: AbortSignal | undefined,
  ): Promise<unknown> => {
    const procs = liveProcedures.current as
      | Record<string, Record<string, ProcedureFn>>
      | null
      | undefined;
    const fn = procs?.[ns]?.[verb];
    if (typeof fn !== "function") {
      throw new Error(
        `reServeSurface: procedure "${ns}.${verb}" invoked with no live upstream link`,
      );
    }
    return fn(input, { signal });
  };
  const proceduresDeps: Record<string, Record<string, unknown>> = {};
  for (const [ns, verbs] of Object.entries(spec.procedures ?? {})) {
    const nsDeps: Record<string, unknown> = {};
    for (const verb of Object.keys(verbs)) {
      nsDeps[verb] = (o: { input?: unknown; signal?: AbortSignal }) =>
        forwardProcedure(ns, verb, o.input, o.signal);
    }
    proceduresDeps[ns] = nsDeps;
  }

  // implementSurface is fail-fast: a member missing from deps throws at build, so
  // the walk above must cover EVERY member of the source surface (it does — one pass
  // per kind). The dynamic build is cast once at this boundary, exactly as the
  // framework's own dynamic walks cast.
  const deps = {
    cells: cellsDeps,
    collections: collectionsDeps,
    streams: streamsDeps,
    events: eventsDeps,
    procedures: proceduresDeps,
  } as unknown as ImplementSurfaceDeps<S>;

  // The re-serve owns a SHARED, bounded channel (used by both the surface deps
  // and the cell fold), so it serves on the caller-provided-channel constructor
  // — the runtime does not own the channel's lifetime, the re-serve does.
  const runtime = implementSurfaceOnPublisher(surface, deps, channel);
  const ctx = runtime.ctx as {
    cells: Record<
      string,
      { set: (v: unknown, opts?: CellCtxSetOpts) => void } | undefined
    >;
    collections: Record<
      string,
      | {
          upsert: (k: unknown, v: unknown) => void;
          remove: (k: unknown) => void;
        }
      | undefined
    >;
  };
  // `implementSurfaceOnPublisher` already returns the FINAL top-level router
  // (no re-flatten needed — the double-prefix is gone at the framework seam).
  const router = runtime.router;

  // ── The reconnect-mirror pump ─────────────────────────────────────────────
  // The sink folds VALUE cells + collections into the per-binding stores; streams
  // (relayed per-subscriber) and procedures (forwarded via the holder) are NOT in
  // the sink. Marking the session connected on the first folded frame is the
  // handshake cue the pump can't infer generically.
  const makeSink = (): SurfaceSink<S> => {
    let first = true;
    const onFirst = (): void => {
      if (first) {
        first = false;
        session.markConnected();
      }
    };
    const cells: Record<string, (v: unknown) => void> = {};
    for (const key of Object.keys(spec.cells ?? {})) {
      const cell = ctx.cells[key];
      if (!cell) {
        throw new Error(
          `reServeSurface: implementSurface produced no cell ctx for "${key}"`,
        );
      }
      // Fold the agent's frame through the framework's OWN write path
      // (`ctx.cells.<key>.set` = equals-gate → store.set → bus.publish) — this is
      // the only writer of the local mirror, and the only place `equals` guards
      // (the wire-write forward path bypasses it, closing the h3 dedup edge).
      // `markConnected` fires on the first folded frame.
      //
      // REBIND EPOCH (#1681): a fresh spawn (this sink is minted once PER spawn)
      // re-serving a cell value EQUAL to the pre-drain one would be swallowed by
      // the equals-gate — so a downstream holder (kolu-server's adopted-stale
      // banner / connection recovery) could not tell "rebound and confirmed" from
      // "stale". Force ONE republish on the FIRST fold of this spawn to cross the
      // gate; every later fold in the same spawn keeps steady-state dedup.
      let firstFold = true;
      cells[key] = (value) => {
        onFirst();
        cell.set(value, firstFold ? { force: true } : undefined);
        firstFold = false;
      };
    }
    const collections: Record<
      string,
      {
        upsert: (k: unknown, v: unknown) => void;
        remove: (k: unknown) => void;
        initialKeys: () => Iterable<unknown>;
      }
    > = {};
    for (const key of Object.keys(spec.collections ?? {})) {
      const coll = ctx.collections[key];
      if (!coll) {
        throw new Error(
          `reServeSurface: implementSurface produced no collection for "${key}"`,
        );
      }
      const cache = collectionCaches.get(key);
      if (!cache) {
        // Structurally guaranteed (same `Object.keys(spec.collections)` key set) —
        // fail loud like the sibling `ctx.cells`/`ctx.collections` lookups rather
        // than silently degrading `initialKeys` to "nothing carried over".
        throw new Error(
          `reServeSurface: no cache registered for collection "${key}"`,
        );
      }
      collections[key] = {
        upsert: (k, v) => {
          onFirst();
          coll.upsert(k, v);
        },
        remove: (k) => coll.remove(k),
        // Hand the mirror this spawn's carry-over keys so its first fresh snapshot
        // prunes the ones that departed while the link was down (#1661 candidate 1).
        initialKeys: () => cache.keys(),
      };
    }
    return { cells, collections } as unknown as SurfaceSink<S>;
  };

  // The re-serve's supervision handle: `close()` aborts THIS pump (without
  // destroying the caller-owned session) and releases the runtime's own sources.
  // The pump's own `.done` is the primary settle (session destroyed / mirror
  // fault); an owned runtime fault (a cell connector rejecting) also reaches
  // `done` — the re-serve is now a supervised source, not a floating pump.
  const pumpAbort = new AbortController();
  const pumpDone = pumpRemoteSurface<S>({
    source,
    session,
    makeSink,
    liveProcedures,
    liveClient,
    signal: pumpAbort.signal,
    log,
  });

  // Supervise the internal runtime + the pump through the framework's
  // terminal-source combinator (SR5 — the doctrine this file used to hand-roll,
  // SR1's "deferred to PR5"). The pump is a TERMINAL source: it drives the runtime
  // and ends on its own when the session is destroyed, so its settle is `done`'s
  // resolving edge; an owned runtime fault (a cell connector rejecting) also
  // reaches `done`; `close` aborts the pump FIRST (its active mirror's per-key
  // pumps settle via signal.reason — #1719), then releases the runtime.
  const { done, close } = superviseTerminalSource(runtime, {
    done: pumpDone,
    // The pump's atomic teardown verb: abort THIS pump (without destroying the
    // caller-owned session), then await its settle (its per-key pumps settle via
    // signal.reason — #1719) before the combinator releases the runtime.
    close: async () => {
      pumpAbort.abort();
      await pumpDone.catch(() => {});
    },
  });

  return { surface, router, done, close };
}
