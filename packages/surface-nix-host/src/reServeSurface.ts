/**
 * `reServeSurface` — re-serve a remote agent's surface downstream, per its
 * declared forwarding policy, with per-binding scope.
 *
 * A re-serving PARENT (kolu-server fronting a padi; drishti fronting its agent)
 * dials one remote agent over a {@link HostSession} and re-serves that agent's
 * surface to its own downstream clients (a browser, a TUI). This assembles the
 * whole re-serve from parts the shared stack already owns — the reconnect-mirror
 * loop ({@link pumpRemoteSurface}), the connection-health seam ({@link
 * mirroredSurface} + {@link seedConnectionCell}), and `implementSurface` — and
 * routes EACH member by the surface's forwarding policy ({@link RelayPolicy},
 * W1's per-member classification):
 *
 *   - **cells** + **collections** (always `value`) — folded into per-binding
 *     stores by the mirror sink, held across an upstream drop and REPLAYED on the
 *     next spawn (a rebind re-seeds the store; a collection's carry-over keys are
 *     reconciled on the fresh snapshot, so a key that departed while down is
 *     dropped without an empty flash). A cell READS from the mirror; a cell WRITE
 *     throws (the re-serve is read-only until W2.2 forwards writes).
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
 * the existing `buildHostRegistry.buildEntry`, keyed by the connection's declared
 * host) — one mirror-store set per bound host, shared by every connection
 * watching that host, replacing the single module-level router+store kolu-server
 * wires today. There is no global router here to switch.
 *
 * SELF-CONTAINED at W2.1: its consumers are its own tests plus the paired drishti
 * run. kolu-server binds it at W2.2.
 */

import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import type { ProcedureForwarders, SurfaceSink } from "@kolu/surface/mirror";
import {
  type ImplementSurfaceDeps,
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import type { AnyContractRouter } from "@orpc/contract";
import { implement } from "@orpc/server";
import { mirroredSurface, type WithConnection } from "./connection";
import { seedConnectionCell } from "./connectionPipe";
import {
  type LiveSpawnHolder,
  observableHolder,
  pumpRemoteSurface,
} from "./hostFanout";
import type { AgentClient, HostSession } from "./hostSession";
import {
  failThroughStreamCore,
  type ForwardableStream,
  holdOpenStreamCore,
  type RelayPolicy,
} from "./relayStream";

export interface ReServeSurfaceOptions<
  S extends SurfaceSpec,
  C extends AnyContractRouter,
> {
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
  /** The long-lived host session whose successive spawns are mirrored. */
  session: HostSession<C>;
  /** Diagnostic sink. Default no-op. */
  log?: (line: string) => void;
}

export interface ReServedSurface<S extends SurfaceSpec> {
  /** The re-served surface — `source` + the get-only `connection` health cell. */
  surface: Surface<WithConnection<S>>;
  /** The per-binding oRPC router (flattened for a handler / `directLink`). */
  router: unknown;
  /** Settles when the pump loop exits (the session was destroyed). It can also
   *  REJECT on an unrecoverable mirror fault — a `SinkError` (a broken local fold)
   *  or a client/surface mismatch — which STOPS the pump (no further reconnect). A
   *  consumer MUST observe `done` and surface such a fault loudly (e.g. drive the
   *  `connection` cell to failed); dropping it leaks an unhandled rejection and a
   *  silently-dead binding. (#1661 candidate 9; consumer wiring is W2.2.) */
  done: Promise<void>;
}

/** The runtime shape of a forwarding stub — loosely typed here; the precise
 *  per-verb type lives at the `ProcedureForwarders<S>` boundary the pump sets. */
type ProcedureFn = (
  input?: unknown,
  opts?: { signal?: AbortSignal },
) => Promise<unknown>;

export function reServeSurface<
  S extends SurfaceSpec,
  C extends AnyContractRouter,
>(opts: ReServeSurfaceOptions<S, C>): ReServedSurface<S> {
  const log = opts.log ?? (() => {});
  const { source, policy, session } = opts;
  const spec = source.spec;
  // The downstream surface = the agent's base + the gate-closed `connection` cell.
  const surface = mirroredSurface(source);

  // A source surface must declare at least one CELL. `markConnected` (below) fires
  // on the first folded CELL frame — a cell always emits a snapshot on connect, so
  // it is the structural on-connect handshake cue, and it also keeps the mirror
  // alive (a foldless mirror would settle instantly and clear `liveClient`). A
  // cell-less surface would never mark connected → the connection gate stays closed
  // and the connect watchdog cycles the link to failed. Fail loud at build. (#1661
  // candidate 7.)
  if (Object.keys(spec.cells ?? {}).length === 0) {
    throw new Error(
      "reServeSurface: source surface declares no cells — markConnected is wired to the first folded cell frame (a cell's on-connect snapshot), so a cell-less surface would never mark the session connected. Add a status cell.",
    );
  }

  // ONE channel factory, shared by `implementSurface` (the deps below) AND the cell
  // fold (which publishes onto the same `<key>:changed` channel a cell's `get`
  // subscribes) — `inMemoryChannelByName` returns the same instance per name.
  const channel = inMemoryChannelByName();

  // Live-spawn holders the pump drives; the relays read `liveClient` and the
  // procedure forwarders read `liveProcedures`. `observableHolder` gives the
  // hold-open relays a `whenChanged` to rebind on.
  const liveClient = observableHolder<AgentClient<C>>();
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

  // Cells — the re-serve is a READ mirror: a downstream READ folds from the agent,
  // but a downstream WRITE (set/patch/test__set) must NOT silently mutate the local
  // mirror store (a phantom write the next mirrored frame reverts). So each cell's
  // `get` folds from a value store while its store's `set` THROWS — the wire write
  // handlers reject loudly. The FOLD does not go through that throwing `set`: it
  // writes the value and publishes directly onto the cell's own `<key>:changed`
  // channel (the same instance `get` subscribes), so a mirrored frame still reaches
  // downstream subscribers. A fixture that needs to write a cell targets the agent
  // directly; full write-forwarding is W2.2. (#1661 candidate 8.)
  //
  // W2.2 NOTE: this fold intentionally mirrors `cellHandlers.applyAndPublish`
  // (store.set + bus.publish) MINUS the equals/onWrite gates the re-serve doesn't
  // want — a coupling to reserve when W2.2 revisits the cell contract. The cleaner
  // deeper form (per the altitude review) is to narrow each mirrored cell's verbs
  // to `["get"]` at the re-serve seam — as the `connection` cell already is — so a
  // wire write is unrepresentable rather than a runtime throw and the fold routes
  // through a normal `ctx.set`, dropping both the throwing store and this side
  // channel. Deferred with write-forwarding (which needs the verbs PRESENT to
  // forward, hence throw-verbs-present here) — one W2.2 decision, not two.
  const cellFolds = new Map<string, (v: unknown) => void>();
  const cellsDeps: Record<string, unknown> = {};
  for (const [key, cellSpec] of Object.entries(spec.cells ?? {})) {
    const value = inMemoryStore((cellSpec as { default: unknown }).default);
    const changed = channel<unknown>(`${key}:changed`);
    cellFolds.set(key, (v) => {
      value.set(v);
      changed.publish(v);
    });
    cellsDeps[key] = {
      store: {
        get: () => value.get(),
        set: () => {
          throw new Error(
            `reServeSurface: cell "${key}" is read-only on the re-serve — a write does not cross to the agent (cell writes are forwarded in W2.2; see PR #1661 candidate 8). Write a fixture against the agent directly.`,
          );
        },
      },
    };
  }
  // The connection cell IS written locally — by the pump, off `session.onState`
  // (server-internal, via `ctx`), not by a wire client — so it keeps a normal store.
  cellsDeps.connection = seedConnectionCell();

  // Collections (always folded as value) → per-key caches the mirror sink folds into.
  // Each cache is kept per key so the sink can hand the mirror its carry-over keys
  // (`initialKeys`) on reconnect — the fresh snapshot then prunes keys that departed
  // while the link was down (no stale ghost rows, no empty flash). (#1661 candidate 1.)
  const collectionCaches = new Map<string, Map<unknown, unknown>>();
  const collectionsDeps: Record<string, unknown> = {};
  for (const key of Object.keys(spec.collections ?? {})) {
    const cache = new Map<unknown, unknown>();
    collectionCaches.set(key, cache);
    collectionsDeps[key] = {
      readAll: () => cache,
      upsert: (k: unknown, v: unknown) => {
        cache.set(k, v);
      },
      remove: (k: unknown) => {
        cache.delete(k);
      },
    };
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
      client: AgentClient<C>,
    ): ForwardableStream<unknown, unknown> =>
      (
        client as unknown as {
          surface: Record<string, ForwardableStream<unknown, unknown>>;
        }
      ).surface[member] as ForwardableStream<unknown, unknown>;
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
  // the walk above must cover EVERY member of the mirrored surface (it does — one
  // pass per kind, plus `connection`). The dynamic build is cast once at this
  // boundary, exactly as the framework's own dynamic walks cast.
  const deps = {
    channel,
    cells: cellsDeps,
    collections: collectionsDeps,
    streams: streamsDeps,
    events: eventsDeps,
    procedures: proceduresDeps,
  } as unknown as ImplementSurfaceDeps<WithConnection<S>>;

  const fragment = implementSurface(surface, deps);
  const ctx = fragment.ctx as {
    cells: Record<string, { set: (v: unknown) => void } | undefined>;
    collections: Record<
      string,
      | {
          upsert: (k: unknown, v: unknown) => void;
          remove: (k: unknown) => void;
        }
      | undefined
    >;
  };
  // The composed connection cell is guaranteed by `mirroredSurface`; capture it
  // once (fail-fast if the seam ever changes) for the pump to write link health.
  const connectionCell = ctx.cells.connection;
  if (!connectionCell) {
    throw new Error(
      "reServeSurface: mirroredSurface did not compose a connection cell",
    );
  }
  // Flatten the `{ surface }` fragment once (a raw fragment double-prefixes to
  // `surface/surface/…`), the pattern kolu's own server + the teaching example use.
  const router = implement(surface.contract).router({ ...fragment.router });

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
      const fold = cellFolds.get(key);
      if (!fold) {
        throw new Error(`reServeSurface: no fold registered for cell "${key}"`);
      }
      cells[key] = (value) => {
        onFirst();
        fold(value);
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
      collections[key] = {
        upsert: (k, v) => {
          onFirst();
          coll.upsert(k, v);
        },
        remove: (k) => coll.remove(k),
        // Hand the mirror this spawn's carry-over keys so its first fresh snapshot
        // prunes the ones that departed while the link was down (#1661 candidate 1).
        initialKeys: () => cache?.keys() ?? [],
      };
    }
    return { cells, collections } as unknown as SurfaceSink<S>;
  };

  const done = pumpRemoteSurface<S, C>({
    source,
    session,
    makeSink,
    liveProcedures,
    liveClient,
    // Passing `connection` makes the pump carry link health onto the cell itself
    // (subscribes `session.onState` once) — the wiring #1564 says a re-serve
    // can't forget.
    connection: { set: connectionCell.set },
    log,
  });

  return { surface, router, done };
}
