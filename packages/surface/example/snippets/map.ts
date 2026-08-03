/**
 * A surface MAP — the blocks "How to serve a map of surfaces", "How to operate a
 * fleet safely", and the `@kolu/surface-map` reference embed. One entry surface,
 * typed once, keyed by host at runtime, served as one and consumed as chips + a
 * switchable canvas.
 *
 * Typechecked, never executed — the reactive `.use()` hooks and the session
 * dials live inside functions / would throw outside a reactive owner, but their
 * call shapes are what the docs pin.
 */

import type { UnaryEffect } from "@kolu/surface/client";
import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import type { WireTransport } from "@kolu/surface/link";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { createLiveSignal } from "@kolu/surface/solid";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  defineSurfaceMap,
  type EntryStatus as RealEntryStatus,
  type FailureEvidence,
  type KeyCodec,
  type MembershipId,
} from "@kolu/surface-map";
import {
  connectSurfaceMap,
  type Entry,
  scopedByEntry,
} from "@kolu/surface-map/client";
import {
  type EntryConnectionState,
  type EntryFault,
  type EntrySession,
  type MapRegistry,
  serveSurfaceMap,
} from "@kolu/surface-map/server";
import {
  type AgentClient,
  agentBinaryCache,
  directAgentDerivation,
  makeSession,
  pumpRemoteSurface,
  type Session,
  type SessionState,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import { Effect, Schema } from "effect";
import { createSignal } from "solid-js";
import { match, P } from "ts-pattern";

// ── The per-host entry surface — one machine's `top` ─────────────────────
const LoadSchema = Schema.Struct({
  avg: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
});
const PidSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ProcSchema = Schema.Struct({
  command: Schema.String,
  cpuPct: Schema.Number,
});
const KillArgsSchema = Schema.Struct({ pid: PidSchema });
const KilledSchema = Schema.Struct({ ok: Schema.Boolean });

const entry = defineSurface({
  cells: { load: { schema: LoadSchema, default: { avg: [0, 0, 0] } } },
  collections: { processes: { keySchema: PidSchema, schema: ProcSchema } },
  procedures: {
    proc: { kill: { input: KillArgsSchema, output: KilledSchema } },
  },
});

type SF = SurfaceTypes<typeof entry.spec>;
type Pid = SF["collections"]["processes"]["Key"];
type Proc = SF["collections"]["processes"]["Value"];
const DEFAULT_LOAD: SF["cells"]["load"]["Value"] = { avg: [0, 0, 0] };

// #region define
const HostKeySchema = Schema.String;
const identityCodec: KeyCodec<string> = { encode: (k) => k, decode: (s) => s };

// The domain failure schema validates the value a failed entry publishes — a
// failed member cannot exist without one (there is no fabricated fallback cause).
const hostFailureSchema = Schema.Struct({ reason: Schema.String });
type HostFailure = typeof hostFailureSchema.Type;

const hostMap = defineSurfaceMap({
  key: HostKeySchema,
  entry,
  codec: identityCodec,
  failure: hostFailureSchema,
});
// #endregion define

// ── One binding per host: dial over ssh, mirror inward, re-serve a dispatch ──
interface HostBinding {
  dispatch: SurfaceDispatch;
  state(): EntryConnectionState<"copying", HostFailure>;
  onStateChange(cb: () => void): () => void;
  destroy(): void;
}

// Project the session's connection state onto the map's per-entry state — one
// dead box becomes exactly one honest `failed` chip. The ssh connector's
// `probing`/`provisioning` phases fold to the map's coarse `copying` bucket;
// the fine phase rides the per-host `connection` fact.
function projectState(
  s: SessionState<SshProv>,
): EntryConnectionState<"copying", HostFailure> {
  return match(s)
    .with({ phase: P.union("probing", "provisioning") }, () => ({
      kind: "copying" as const,
    }))
    .with({ phase: "connecting" }, () => ({ kind: "connecting" as const }))
    .with({ phase: "connected" }, (connected) => ({
      // `makeSession` measures the far-end wall-clock offset off the reserved
      // `system.clockNow` at admit and carries it on the `connected` arm — propagate
      // that real value (`number | null`), don't fake a 0. Readiness is link-liveness,
      // NOT clock-measured: a connected session is `connected` whether or not the offset
      // has landed. `null` (not-yet-measured) rides THROUGH; the clock reader renders "—"
      // for it until the probe lands. (A `0` on a skewed host would mis-map its timestamps.)
      kind: "connected" as const,
      clockOffset: connected.clockOffset,
    }))
    .with({ phase: "disconnected" }, () => ({
      // Transient (no domain failure) → projects to `warming`, self-heals.
      kind: "disconnected" as const,
    }))
    .with({ phase: "failed" }, (failed) => ({
      // A terminal give-up carries the schema-valid domain failure it publishes, AND
      // that failure's EVIDENCE — the session's own retained log tail off this same
      // frame. The two are one record, so a client's liveness floor (which drops the
      // live `connection` word over a dead link) can never leave a reason without the
      // output that produced it.
      kind: "failed" as const,
      failure: { reason: failed.error },
      evidence: failed.log,
    }))
    .exhaustive();
}

/** Where provisioning may PREFETCH this agent's binaries from — REQUIRED on
 *  every derivation, since a cache-blind provisioning path is unspellable. A
 *  real deployment DERIVES it (`readBakedBinaryCache(source)` reads what
 *  `mkProvenAgentSource` baked from the flake's own `nixConfig`, so the
 *  TypeScript and the Nix cannot disagree); a fleet whose `.drv` comes bare
 *  from the environment states one inline, ONCE, against a reserved-invalid
 *  host. Same value, same shape as the runnable `fleet-top` example this
 *  snippet mirrors. */
const EXAMPLE_BINARY_CACHE = agentBinaryCache({
  substituters: ["https://cache.test.invalid/fleet-top"],
  trustedPublicKeys: ["fleet-top:0000000000000000000000000000000000000000000="],
});

// #region binding
function buildHostBinding(host: string, agentDrv: string): HostBinding {
  // The connector takes the SURFACE as a value — Effect RPC builds its client
  // from `surface.group` and the face is re-nested from `surface.spec`.
  const session: Session<AgentClient, SshProv> = makeSession({
    initialConnection: "probing",
    connectOnce: sshConnector({
      surface: entry,
      host,
      binary: "fleet-top-agent",
      // Policy-free: the consumer composes the localhost arm's spawn env, keeping only
      // the keys that are SET (an empty HOME/PATH would misdirect lookups). kolu uses
      // kolu-pty's `composeSpawnEnv`. Never the caller's ambient `process.env`; unused for ssh.
      localEnv: Object.fromEntries(
        (["HOME", "PATH"] as const)
          .map((k): [string, string | undefined] => [k, process.env[k]])
          .filter((e): e is [string, string] => e[1] !== undefined),
      ),
      resolveDrvPath: () =>
        // deferred per dial; the cache names where binaries prefetch from
        Promise.resolve(directAgentDerivation(agentDrv, EXAMPLE_BINARY_CACHE)),
    }),
  });

  const processes = new Map<Pid, Proc>();
  const runtime = implementSurface(entry, {
    cells: { load: { store: inMemoryStore(DEFAULT_LOAD) } },
    collections: {
      processes: {
        readAll: () => processes,
        upsert: (k, v) => {
          processes.set(k, v);
        },
        remove: (k) => {
          processes.delete(k);
        },
      },
    },
    procedures: {
      proc: {
        // `kill` forwards to the CURRENT live agent client — a kill can land
        // across a reconnect, so never a per-spawn stub. This procedure declares
        // no error channel, so an upstream failure is UNDECLARED and `orDie` keeps
        // it a loud defect rather than something a caller could branch on.
        kill: ({ input }) =>
          Effect.gen(function* () {
            const pending = session.currentClient();
            if (pending === null) throw new Error("no live agent link");
            const client = yield* Effect.promise(() => pending);
            const kill = client.surface.proc?.kill as UnaryEffect<
              { pid: number },
              { ok: boolean },
              never
            >;
            return yield* Effect.orDie(kill(input));
          }),
      },
    },
  });

  // Fold the agent's frames into the local runtime; the first `load` frame is
  // the handshake that flips the session to `connected`.
  let firstLoad = true;
  void pumpRemoteSurface({
    source: entry,
    session,
    makeSink: ({ seq: _seq }) => {
      firstLoad = true;
      return {
        cells: {
          load: (v) => {
            if (firstLoad) {
              firstLoad = false;
              session.markConnected();
            }
            runtime.ctx.cells.load.set(v);
          },
        },
        collections: {
          processes: {
            upsert: (k, v) => runtime.ctx.collections.processes.upsert(k, v),
            remove: (k) => runtime.ctx.collections.processes.remove(k),
          },
        },
      };
    },
  });

  // `directDispatch` takes the served surface itself and calls its handlers
  // in-process — the map never learns whether the dispatch crosses a wire.
  const dispatch = directDispatch(runtime);

  let latest: SessionState<SshProv> = {
    phase: "probing",
    log: [],
    sinceMs: 0,
    campaignEpoch: 0,
  };
  const unsub = session.onState((s) => {
    latest = s;
  });
  return {
    dispatch,
    state: () => projectState(latest),
    onStateChange: (cb) => session.onState(() => cb()),
    destroy: () => {
      unsub();
      session.destroy();
    },
  };
}
// #endregion binding

export function serveMap(hosts: string[], agentDrv: string) {
  const bindings = new Map<string, HostBinding>();
  for (const host of hosts)
    bindings.set(host, buildHostBinding(host, agentDrv));

  const changeCbs = new Set<() => void>();
  for (const b of bindings.values())
    b.onStateChange(() => {
      for (const cb of changeCbs) cb();
    });

  // #region registry
  // The hand-built MapRegistry is the ONE writer of membership; `resolve(host)`
  // hands the map each host's dispatch + projected connection state.
  const registry: MapRegistry<string, "copying", HostFailure> = {
    members: () => [...bindings.keys()],
    subscribe: (onChange) => {
      changeCbs.add(onChange);
      return () => changeCbs.delete(onChange);
    },
    has: (k) => bindings.has(k),
    resolve: (
      k,
    ): EntrySession<"copying", HostFailure> | EntryFault<HostFailure> => {
      const b = bindings.get(k);
      if (b === undefined)
        return { kind: "fault", failure: { reason: `unknown host: ${k}` } };
      return { kind: "session", dispatch: b.dispatch, state: b.state() };
    },
  };
  // #endregion registry

  // #region serve
  // `serveSurfaceMap` returns the SAME `{ group, handlers }` pair
  // `implementSurface` does — a host merges one value pair into its own served
  // surface, and a tag carries its own route, so nothing is re-prefixed at the
  // mount site.
  const { group, handlers, dispose } = serveSurfaceMap(hostMap, registry);
  // #endregion serve

  return { group, handlers, dispose, registry };
}

// ── The client half — connect the map and read it as chips + a canvas ────
export function connectMap(transport: WireTransport) {
  // #region connect
  // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` a wire link factory
  // minted together, so the half-open watchdog provably probes the transport it
  // reconnects — and mints the branded handle the map client requires.
  const live = createLiveSignal(transport, {});
  const app = connectSurfaceMap(hostMap, live);
  // #endregion connect
  return app;
}

export function readMap(transport: WireTransport) {
  const app = connectMap(transport);
  const [activeHost] = createSignal<string>("localhost");

  // #region useentry
  const entries = app.entries.use(); // the ONE membership authority (the chips)
  const hosts = entries.keys(); // each chip's key
  const status = (host: string) => app.entry(host).state().kind; // warming/connected/failed

  const active = app.useEntry(activeHost); // re-keys on switch; old subs dispose
  const load = active.cells.load.use();
  const processes = active.collections.processes.use();
  // #endregion useentry

  return { hosts, status, load, processes, active };
}

// ── Per-host CLIENT state (retained by membership) + the key codec ───────
export function ownedState(transport: WireTransport) {
  const app = connectMap(transport);
  // `active` is APP POLICY and NULLABLE: `null` = nothing selected (drishti's
  // fleet grid, no host chosen). kolu's `activeHost` is never null.
  const [activeHost] = createSignal<string | null>("localhost");

  // #region scopedbyentry
  // Per-host CLIENT state whose lifetime is `entries` MEMBERSHIP — the retained
  // dual of `useEntry`'s dispose-on-switch. An owner is built LAZILY on a key's
  // first activation, RETAINED across every switch-away, and DISPOSED the instant
  // its key leaves `entries` (a removed-then-re-added host is a FRESH member).
  const scopes = scopedByEntry(app, activeHost, (host, ctx) => ({
    tiles: new Map<number, string>(), // this host's OWN state — plain, per-host
    focusedPid: createSignal<number | null>(null),
    isFocused: ctx.isActive, // active-only discipline lives INSIDE the owner
    label: host, // the key is in scope for whatever the owner builds
  }));

  scopes.active(); // the ACTIVE host's world: `T | undefined` (null / vanished)
  scopes.get("web-01"); // a background peek at ANY key — never CREATES an owner
  // #endregion scopedbyentry

  // #region codec
  // `codec` — the ONE key-identity authority: the canonical wire string every
  // channel name, dedup key, and membership entry is keyed on. `scopedByEntry`
  // folds each key through it rather than trusting `===` reference identity.
  const wire: string = app.codec.encode("web-01"); // K → wire string
  const key: string = app.codec.decode(wire); // wire string → K
  // #endregion codec

  return { scopes, wire, key };
}

// #region rpc
// Every declared procedure rides `entry.procedures.<ns>.<verb>`, bound and typed
// straight from the declaration — NO cast. (`entry.rpc` is the STRUCTURAL member
// face, reserved for the `system.*` members plus the escape hatch.) The
// key-injecting dispatch folds `{ mapKey }` into every call, so the caller never
// passes the key.
const kill = (
  active: Entry<typeof entry.spec>,
  pid: number,
): Effect.Effect<{ ok: boolean }, unknown> =>
  active.procedures.proc.kill({ pid });
// #endregion rpc

// #region entrystatus
// `Conn` (SR9): the fine per-entry connection payload, carried on the LIVE arms and
// parameterized like `Failure` — the map validates it against its own `connection`
// schema, never enumerating it. It is the ONE authority the coarse `kind` (the dot) and
// the fine word both derive from; optional, so a connection-less map omits it. The
// `failed` arm carries none at all — see the note on that arm below.
type EntryStatus<Failure = unknown, Conn = unknown> =
  // `membershipId`: opaque, never-reused per-add identity — a BRANDED `MembershipId`
  // (an empty/fabricated bare string is a compile error), minted only by
  // `serveSurfaceMap` / the wire decode. Clients key cached owners on
  // `{encodedKey, membershipId}`, so a same-key re-add / authority restart rebuilds.
  | { kind: "warming"; membershipId: MembershipId; connection?: Conn }
  | {
      kind: "connected";
      membershipId: MembershipId;
      clockOffset: number | null; // own-clock offset; null = not-yet-measured
      connection?: Conn;
    }
  // No `connection` on this arm — deliberately. The failed entry's live word would be
  // the same frame `evidence` was pinned from, so `connection?.log` here was a second,
  // floorable copy of the tail. Removing the field makes that read a compile error.
  | {
      kind: "failed";
      membershipId: MembershipId;
      failure: Failure; // schema-valid domain failure
      evidence: FailureEvidence; // the retained output tail that EVIDENCES it
    };
// #endregion entrystatus

// Grounding: the shape shown above is mutually assignable to the real exported
// `EntryStatus` — this fails to compile the instant the wire arms drift.
type _Assert<A, B> = A extends B ? (B extends A ? true : never) : never;
const _entryStatusEquiv: _Assert<EntryStatus, RealEntryStatus> = true;

export { kill, _entryStatusEquiv };
