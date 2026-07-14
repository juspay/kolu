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

import { directLink } from "@kolu/surface/links/direct";
import { defineSurface, type SurfaceTypes } from "@kolu/surface/define";
import { implement } from "@kolu/surface/peer-server";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { createLiveSignal, type WatchableSocket } from "@kolu/surface/solid";
import {
  type AgentClient,
  makeSession,
  pumpRemoteSurface,
  type Session,
  type SessionState,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import {
  defineSurfaceMap,
  type EntryStatus as RealEntryStatus,
  type KeyCodec,
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
import { createSignal } from "solid-js";
import { z } from "zod";

// ── The per-host entry surface — one machine's `top` ─────────────────────
const LoadSchema = z.object({
  avg: z.tuple([z.number(), z.number(), z.number()]),
});
const PidSchema = z.number().int().nonnegative();
const ProcSchema = z.object({ command: z.string(), cpuPct: z.number() });

const entry = defineSurface({
  cells: { load: { schema: LoadSchema, default: { avg: [0, 0, 0] } } },
  collections: { processes: { keySchema: PidSchema, schema: ProcSchema } },
  procedures: {
    proc: {
      kill: {
        input: z.object({ pid: PidSchema }),
        output: z.object({ ok: z.boolean() }),
      },
    },
  },
});

type SF = SurfaceTypes<typeof entry.spec>;
type Pid = SF["collections"]["processes"]["Key"];
type Proc = SF["collections"]["processes"]["Value"];
const DEFAULT_LOAD: SF["cells"]["load"]["Value"] = { avg: [0, 0, 0] };

// #region define
const HostKeySchema = z.string();
const identityCodec: KeyCodec<string> = { encode: (k) => k, decode: (s) => s };

// The domain failure schema validates the value a failed entry publishes — a
// failed member cannot exist without one (there is no fabricated fallback cause).
const hostFailureSchema = z.object({ reason: z.string() });
type HostFailure = z.infer<typeof hostFailureSchema>;

const hostMap = defineSurfaceMap({
  key: HostKeySchema,
  entry,
  codec: identityCodec,
  failure: hostFailureSchema,
});
// #endregion define

// ── One binding per host: dial over ssh, mirror inward, re-serve a link ──
interface HostBinding {
  link: unknown;
  state(): EntryConnectionState<"copying", HostFailure>;
  onStateChange(cb: () => void): () => void;
  destroy(): void;
}

// Project the session's connection state onto the map's per-entry state — one
// dead box becomes exactly one honest `failed` chip. The ssh connector's two
// provisioning phases (`copying`/`building`) both fold to the map's coarse
// `copying` bucket; the fine phase rides the per-host `connection` cell.
function projectState(
  s: SessionState<SshProv>,
): EntryConnectionState<"copying", HostFailure> {
  switch (s.phase) {
    case "probing":
    case "copying":
    case "building":
      return { kind: "copying" };
    case "connecting":
      return { kind: "connecting" };
    case "connected":
      return { kind: "connected", clockOffset: 0 };
    case "disconnected":
      // Transient (no domain failure) → projects to `warming`, self-heals.
      return { kind: "disconnected" };
    case "failed":
      // A terminal give-up carries the schema-valid domain failure it publishes.
      return { kind: "failed", failure: { reason: s.error } };
  }
}

// #region binding
function buildHostBinding(host: string, agentDrv: string): HostBinding {
  const session: Session<
    AgentClient<typeof entry.contract>,
    SshProv
  > = makeSession({
    initialConnection: "probing",
    connectOnce: sshConnector<typeof entry.contract>({
      host,
      binary: "fleet-top-agent",
      resolveDrvPath: () => Promise.resolve(agentDrv), // deferred per dial
    }),
  });

  const processes = new Map<Pid, Proc>();
  const fragment = implementSurface(entry, {
    channel: inMemoryChannelByName(),
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
        // across a reconnect, so never a per-spawn stub.
        kill: async ({ input }) => {
          const pending = session.currentClient();
          if (pending === null) throw new Error("no live agent link");
          return (await pending).surface.proc.kill(input);
        },
      },
    },
  });

  // Fold the agent's frames into the local fragment; the first `load` frame is
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
            fragment.ctx.cells.load.set(v);
          },
        },
        collections: {
          processes: {
            upsert: (k, v) => fragment.ctx.collections.processes.upsert(k, v),
            remove: (k) => fragment.ctx.collections.processes.remove(k),
          },
        },
      };
    },
  });

  const router = implement(entry.contract).router({ ...fragment.router });
  const link = directLink<typeof entry.contract>(router);

  let latest: SessionState<SshProv> = { phase: "probing", log: [], sinceMs: 0 };
  const unsub = session.onState((s) => {
    latest = s;
  });
  return {
    link,
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
  // hands the map each host's link + projected connection state.
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
      return { kind: "session", link: b.link, state: b.state() };
    },
  };
  // #endregion registry

  // #region serve
  // `serveSurfaceMap` returns a FINALIZED top-level router — hand it straight to
  // a transport (here an in-process `directLink`); do NOT flatten it further.
  const { router, dispose } = serveSurfaceMap(hostMap, registry);
  // #endregion serve

  return { router, dispose, registry };
}

// ── The client half — connect the map and read it as chips + a canvas ────
export function connectMap(ws: WatchableSocket) {
  // #region connect
  const transport = createLiveSignal<typeof hostMap.contract>(ws, {});
  const app = connectSurfaceMap(hostMap, transport);
  // #endregion connect
  return app;
}

export function readMap(ws: WatchableSocket) {
  const app = connectMap(ws);
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
export function ownedState(ws: WatchableSocket) {
  const app = connectMap(ws);
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
// `entry.rpc` is typed `unknown` on a generic map — a `ContractRouterClient` over
// an abstract entry spec would overflow TS's union budget. The consumer casts it
// ONCE to its own surface's procedure shape.
type KillRpc = {
  surface: { proc: { kill: (i: { pid: number }) => Promise<{ ok: boolean }> } };
};
const kill = (
  active: Entry<typeof entry.spec>,
  pid: number,
): Promise<{ ok: boolean }> =>
  (active.rpc as KillRpc).surface.proc.kill({ pid });
// #endregion rpc

// #region entrystatus
type EntryStatus<Failure = unknown> =
  // `membershipId`: opaque, never-reused per-add identity — clients key cached owners on
  // `{encodedKey, membershipId}`, so a same-key re-add / authority restart rebuilds.
  | { kind: "warming"; membershipId: string }
  | { kind: "connected"; membershipId: string; clockOffset: number } // own-clock offset
  | { kind: "failed"; membershipId: string; failure: Failure }; // schema-valid domain failure
// #endregion entrystatus

// Grounding: the shape shown above is mutually assignable to the real exported
// `EntryStatus` — this fails to compile the instant the wire arms drift.
type _Assert<A, B> = A extends B ? (B extends A ? true : never) : never;
const _entryStatusEquiv: _Assert<EntryStatus, RealEntryStatus> = true;

export { kill, _entryStatusEquiv };
