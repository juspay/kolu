/**
 * Mirroring a surface over ssh — the blocks "How to mirror a surface over ssh",
 * the `@kolu/surface-remote` reference, and "How to operate a fleet safely"
 * embed. Dial the host with a session, pump its frames into a LOCAL mirror, and
 * re-serve the same surface to browsers.
 *
 * Typechecked, never executed — the session/pump calls live inside functions so
 * nothing dials at compile time.
 */

import {
  defineSurface,
  isContractVersionCompatible,
  type SurfaceTypes,
} from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceSink } from "@kolu/surface/mirror";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import {
  type AgentClient,
  type AgentDerivation,
  directAgentDerivation,
  makeSession,
  pumpRemoteSurface,
  readBakedAgentSource,
  readBakedBinaryCache,
  type Session,
  sshConnector,
  type SshProv,
} from "@kolu/surface-remote";
import { Schema } from "effect";

// ── The agent's base surface (what it serves over stdio) ─────────────────
const LoadSchema = Schema.Struct({
  avg: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
});
const PidSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const ProcSchema = Schema.Struct({
  command: Schema.String,
  cpuPct: Schema.Number,
});

const base = defineSurface({
  cells: { load: { schema: LoadSchema, default: { avg: [0, 0, 0] } } },
  collections: { processes: { keySchema: PidSchema, schema: ProcSchema } },
});

type SF = SurfaceTypes<typeof base.spec>;
type Pid = SF["collections"]["processes"]["Key"];
type Proc = SF["collections"]["processes"]["Value"];
const DEFAULT_LOAD: SF["cells"]["load"]["Value"] = { avg: [0, 0, 0] };

// Every derivation names where provisioning may PREFETCH its binaries from
// (required — a cache-blind provisioning path is unspellable). DERIVE it, don't
// hand-write it: `mkProvenAgentSource` bakes the declaration into your agent
// source from your flake's OWN `nixConfig`, and these two readers hand back
// exactly that — so the TypeScript and the Nix can never disagree about which
// cache your binaries are in. Both answer on one channel (`Result`), so the
// two source-configuration faults chain and surface as one typed rejection.
const resolveDrv = (_host: string): Promise<AgentDerivation> =>
  readBakedAgentSource()
    .andThen(readBakedBinaryCache)
    .match(
      (binaryCache) =>
        Promise.resolve(
          directAgentDerivation("/nix/store/…-my-agent.drv", binaryCache),
        ),
      (fault) => Promise.reject(fault),
    );

// …or, if you run your own cache and take the .drv from elsewhere, state one
// inline. `agentBinaryCache` is the only way to make the value, so an empty or
// blank declaration cannot reach a derivation:
//
//   const binaryCache = agentBinaryCache({
//     substituters: ["https://cache.example.org/my-agent"],
//     trustedPublicKeys: ["my-agent:0000…="],
//   });

// #region dial
// `AgentClient` is the structural member face — there is no contract type to be
// generic over. The connector takes the SURFACE as a VALUE: Effect RPC builds
// its client from `surface.group`, and the face is re-nested from
// `surface.spec` — neither is recoverable from a type alone, and passing the
// surface is what makes the dialled face and the served group provably the same
// tag set.
const session: Session<AgentClient, SshProv> = makeSession({
  initialConnection: "probing", // an ssh session provisions before it connects
  connectOnce: sshConnector({
    surface: base,
    host: "alice@bob.example", // any ssh target; "localhost" short-circuits
    binary: "my-agent", // exe name inside the realised closure
    // Policy-free: YOU (the consumer) compose the localhost arm's spawn env, keeping only
    // the keys that are SET (an empty HOME/PATH would misdirect lookups). kolu uses
    // kolu-pty's `composeSpawnEnv`. Never the caller's ambient `process.env`; unused for ssh.
    localEnv: Object.fromEntries(
      (["HOME", "PATH"] as const)
        .map((k): [string, string | undefined] => [k, process.env[k]])
        .filter((e): e is [string, string] => e[1] !== undefined),
    ),
    resolveDrvPath: () => resolveDrv("bob.example"), // deferred — see the caution
  }),
});
// #endregion dial

export function buildMirror() {
  const loadStore = inMemoryStore(DEFAULT_LOAD);
  const processes = new Map<Pid, Proc>();

  // #region pump
  // Re-serve the agent's base surface verbatim. (SR9: per-host connection health is a
  // host-map concept — a `@kolu/surface-map` map's `entries` channel carries the fine
  // connection payload, produced by `serveHostMap`; a standalone re-serve like this
  // carries no `connection` cell.)
  const source = base;
  const runtime = implementSurface(source, {
    cells: { load: { store: loadStore } },
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
  });

  void pumpRemoteSurface({
    source,
    session,
    makeSink: ({ seq: _seq }) => ({
      // built per spawn — per-client state resets
      cells: { load: (v) => runtime.ctx.cells.load.set(v) },
      collections: {
        processes: {
          upsert: (k, v) => runtime.ctx.collections.processes.upsert(k, v),
          remove: (k) => runtime.ctx.collections.processes.remove(k),
        },
      },
    }),
  });
  // #endregion pump

  // #region reserve
  // The mirror runtime's `{ group, handlers }` is what any transport takes; a
  // browser consumes the local copy exactly as if the agent were in-process.
  const dispatch = directDispatch(runtime);
  // #endregion reserve

  return { surface: source, runtime, dispatch };
}

// A compact end-to-end mirror — the `@kolu/surface-remote` reference block.
export function mirrorEndToEnd() {
  // #region endtoend
  const src = base;
  const runtime = implementSurface(src, {
    cells: {
      load: { store: inMemoryStore(DEFAULT_LOAD) },
    },
    collections: {
      processes: {
        readAll: () => new Map<Pid, Proc>(),
        upsert: () => {},
        remove: () => {},
      },
    },
  });

  void pumpRemoteSurface({
    source: src,
    session,
    makeSink: ({ seq: _seq }) => ({
      cells: { load: (v) => runtime.ctx.cells.load.set(v) },
      collections: { processes: { upsert: () => {}, remove: () => {} } },
    }),
  });
  // #endregion endtoend
  return runtime;
}

// ── Gate a fleet on contract compatibility (operate-a-fleet-safely) ──────
const OURS = "2.1";
const setSkew = (_skew: boolean): void => {};

const versioned = defineSurface({
  cells: {
    version: {
      schema: Schema.Struct({ contractVersion: Schema.String }),
      default: { contractVersion: "0.0" },
    },
  },
});

// #region compat
// Read the version off the host's identity cell and gate on it BEFORE invoking
// anything else — an additive minor bump is still compatible, so never `==`.
const versionSink = (): SurfaceSink<typeof versioned.spec> => ({
  cells: {
    version: (v) =>
      setSkew(!isContractVersionCompatible(v.contractVersion, OURS)),
  },
});
// #endregion compat

export { versionSink };
