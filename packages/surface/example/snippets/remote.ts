/**
 * Mirroring a surface over ssh — the blocks "How to mirror a surface over ssh",
 * the `@kolu/surface-remote` reference, and "How to operate a fleet safely"
 * embed. Dial the host with a session, pump its frames into a LOCAL mirror, and
 * re-serve the same contract to browsers.
 *
 * Typechecked, never executed — the session/pump calls live inside functions so
 * nothing dials at compile time.
 */

import { directLink } from "@kolu/surface/links/direct";
import {
  defineSurface,
  isContractVersionCompatible,
  type SurfaceTypes,
} from "@kolu/surface/define";
import type { SurfaceSink } from "@kolu/surface/mirror";
import { implement } from "@kolu/surface/peer-server";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import {
  type AgentClient,
  makeSession,
  pumpRemoteSurface,
  seedConnectionCell,
  type Session,
  sshConnector,
} from "@kolu/surface-remote";
import { mirroredSurface } from "@kolu/surface-remote/connection";
import { z } from "zod";

// ── The agent's base surface (what it serves over stdio) ─────────────────
const LoadSchema = z.object({
  avg: z.tuple([z.number(), z.number(), z.number()]),
});
const PidSchema = z.number().int().nonnegative();
const ProcSchema = z.object({ command: z.string(), cpuPct: z.number() });

const base = defineSurface({
  cells: { load: { schema: LoadSchema, default: { avg: [0, 0, 0] } } },
  collections: { processes: { keySchema: PidSchema, schema: ProcSchema } },
});

type SF = SurfaceTypes<typeof base.spec>;
type Pid = SF["collections"]["processes"]["Key"];
type Proc = SF["collections"]["processes"]["Value"];
const DEFAULT_LOAD: SF["cells"]["load"]["Value"] = { avg: [0, 0, 0] };

const resolveDrv = (_host: string): Promise<string> =>
  Promise.resolve("/nix/store/…-my-agent.drv");

// #region dial
const session: Session<AgentClient<typeof base.contract>> = makeSession({
  initialConnection: "copying", // an ssh session provisions before it connects
  connectOnce: sshConnector<typeof base.contract>({
    host: "alice@bob.example", // any ssh target; "localhost" short-circuits
    binary: "my-agent", // exe name inside the realised closure
    resolveDrvPath: () => resolveDrv("bob.example"), // deferred — see the caution
  }),
});
// #endregion dial

export function buildMirror() {
  const loadStore = inMemoryStore(DEFAULT_LOAD);
  const processes = new Map<Pid, Proc>();

  // #region pump
  const source = mirroredSurface(base); // adds + reserves the `connection` cell
  const fragment = implementSurface(source, {
    channel: inMemoryChannelByName(),
    cells: { load: { store: loadStore }, connection: seedConnectionCell() },
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
      cells: { load: (v) => fragment.ctx.cells.load.set(v) },
      collections: {
        processes: {
          upsert: (k, v) => fragment.ctx.collections.processes.upsert(k, v),
          remove: (k) => fragment.ctx.collections.processes.remove(k),
        },
      },
    }),
    // The parent is the sole writer of `connection`: the pump projects the
    // session's lifecycle onto it off `session.onState`.
    connection: { set: (info) => fragment.ctx.cells.connection.set(info) },
  });
  // #endregion pump

  // #region reserve
  // Flatten the mirror fragment into a top-level router; a browser consumes the
  // local copy exactly as if the agent were in-process.
  const router = implement(source.contract).router({ ...fragment.router });
  const link = directLink<typeof source.contract>(router);
  // #endregion reserve

  return { surface: source, router, link };
}

// A compact end-to-end mirror — the `@kolu/surface-remote` reference block.
export function mirrorEndToEnd() {
  // #region endtoend
  const src = mirroredSurface(base);
  const fragment = implementSurface(src, {
    channel: inMemoryChannelByName(),
    cells: {
      load: { store: inMemoryStore(DEFAULT_LOAD) },
      connection: seedConnectionCell(),
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
      cells: { load: (v) => fragment.ctx.cells.load.set(v) },
      collections: { processes: { upsert: () => {}, remove: () => {} } },
    }),
  });
  // #endregion endtoend
  return fragment;
}

// ── Gate a fleet on contract compatibility (operate-a-fleet-safely) ──────
const OURS = "2.1";
const setSkew = (_skew: boolean): void => {};

const versioned = defineSurface({
  cells: {
    version: {
      schema: z.object({ contractVersion: z.string() }),
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
