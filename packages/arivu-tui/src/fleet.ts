/**
 * The `arivu-tui fleet` orchestrator — fan a one-shot dial over N hosts, LIVE-
 * mirror each host's `awareness` collection into one aggregate keyed by
 * (host, terminalId), and push every delta to a sink. No OpenTUI, no Solid
 * here: the sink is plain callbacks, so this is unit-tested under Node with fake
 * clients. `fleet.tsx` wires the sink to a Solid store; `bin.ts` supplies the
 * real connectors (`connectArivu` local, `connectArivuViaHost` remote).
 *
 * Each host is independent: a cold-provisioning box and a fast one connect in
 * parallel, and one dead box surfaces as an `unreachable` host — never sinks the
 * board (the no-fallback rule: a caught dial error SURFACES, it does not
 * collapse the fleet to empty). One `mirrorRemoteSurface` call drives the whole
 * arivu surface — the `version` cell (skew gate), the `awareness` collection
 * (the rows), and the `activity` stream (the live green dot) — into the sink in
 * one shot; the (host, terminalId) keying is the consumer's job and lives here.
 * The same primitive the kolu R-2 fold and the `remote-process-monitor` demo use.
 */

import {
  ARIVU_CONTRACT_VERSION,
  arivuSurface,
  type AwarenessValue,
  type TerminalId,
} from "@kolu/arivu-contract";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import type { Connection } from "./connect.ts";
import type { FleetHost } from "./hosts.ts";
import { snapshotAwareness } from "./read.ts";
import type { FleetHostStatus, FleetSnapshot } from "./fleetTypes.ts";

/** Dials one host's arivu, returning the contract-typed connection. Injected so
 *  the unit test feeds fakes; `bin.ts` supplies the real local/remote dials. The
 *  promise REJECTS on failure (it is not the `fail()`-wrapping CLI connector) so
 *  the orchestrator can turn a dead host into an `unreachable` row. */
export type FleetConnector = (host: FleetHost) => Promise<Connection>;

/** Where the orchestrator pushes live state. `fleet.tsx` implements it over a
 *  Solid store; the unit test records the calls. */
export interface FleetSink {
  setStatus: (label: string, status: FleetHostStatus) => void;
  upsert: (label: string, id: TerminalId, value: AwarenessValue) => void;
  remove: (label: string, id: TerminalId) => void;
  /** The whole set of terminals on this host moving bytes right now (the
   *  `activity` stream's current frame) — drives the live green dot. Replaces the
   *  host's live set each frame (snapshot-then-deltas). */
  setLive: (label: string, live: TerminalId[]) => void;
}

export interface FleetHandle {
  /** Tear every live connection down; in-flight mirrors unwind as their links
   *  close. Idempotent. */
  dispose: () => void;
}

/** Read the host's declared contract version off the `version` cell — the
 *  connectivity + skew probe both fleet entry points (`runHost`, `snapshotFleet`)
 *  share. `firstFrameOrThrow` because the cell ALWAYS opens with a snapshot
 *  frame, so an empty stream is a protocol/link failure (it throws → the
 *  caller's `unreachable`), never a silent collapse to compatible. Returns the
 *  host's version and whether it diverges from ours. */
async function probeContractVersion(
  conn: Connection,
): Promise<{ hostVersion: string; skewed: boolean }> {
  const version = await firstFrameOrThrow(
    await conn.client.surface.version.get({}),
    "arivu version cell yielded no snapshot frame — the host surface stream ended empty (link or protocol failure)",
  );
  return {
    hostVersion: version.contractVersion,
    // Use the framework's `major.minor` predicate, not raw string inequality: an
    // additive host (a newer minor — e.g. one that grew the `activity` stream)
    // is compatible, not skew. A lower minor or a major mismatch is skew.
    skewed: !isContractVersionCompatible(
      version.contractVersion,
      ARIVU_CONTRACT_VERSION,
    ),
  };
}

/** Start mirroring every host into the sink. Returns immediately (the dials run
 *  in the background); the sink sees `connecting` → `connected`/`skew`/`unreachable`
 *  per host and live `upsert`/`remove` as terminals change. */
export function startFleet(opts: {
  hosts: FleetHost[];
  connect: FleetConnector;
  sink: FleetSink;
  log: (line: string) => void;
}): FleetHandle {
  const conns: Connection[] = [];
  let disposed = false;
  for (const host of opts.hosts) {
    opts.sink.setStatus(host.label, { kind: "connecting" });
    void runHost(host, opts, conns, () => disposed);
  }
  return {
    dispose: () => {
      disposed = true;
      for (const c of conns) {
        try {
          c.dispose();
        } catch {
          // Already torn down (the link died first) — nothing to release.
        }
      }
    },
  };
}

async function runHost(
  host: FleetHost,
  opts: {
    connect: FleetConnector;
    sink: FleetSink;
    log: (line: string) => void;
  },
  conns: Connection[],
  isDisposed: () => boolean,
): Promise<void> {
  let conn: Connection;
  try {
    conn = await opts.connect(host);
  } catch (err) {
    // The dial failed — surface it as a distinct, named state, not an empty
    // group. The other hosts keep going.
    opts.sink.setStatus(host.label, {
      kind: "unreachable",
      reason: (err as Error).message,
    });
    return;
  }
  // Disposed mid-dial (the user quit before this slow box connected): drop it.
  if (isDisposed()) {
    conn.dispose();
    return;
  }
  conns.push(conn);

  // Everything AFTER the dial is wrapped per host: the dial succeeded, but the
  // version probe or the mirror's first roundtrip can still reject (a link that
  // came up then dropped, a half-open socket). A rejection here must NOT escape
  // `runHost` — `startFleet` fires it with `void`, so an unhandled rejection
  // would leave the host stranded at `connecting` (and crash the process under
  // the global handler). The no-fallback rule: it SURFACES as this host's
  // `unreachable` header while the rest of the fleet keeps updating.
  try {
    // The version HANDSHAKE first — gate connected-vs-skew with an honest
    // reason on failure, BEFORE mirroring. The `version` cell is the
    // compatibility gate, not live data (arivu is ephemeral; its version never
    // changes mid-connection), so it's a one-shot probe — an empty stream throws
    // into the catch below as this host's `unreachable`, never a silent collapse
    // to connected. (This is why the cell is probed, not folded into the mirror:
    // a mirror swallows per-stream blips, but the handshake must surface.)
    const { hostVersion, skewed } = await probeContractVersion(conn);
    opts.sink.setStatus(
      host.label,
      skewed
        ? { kind: "skew", localVersion: ARIVU_CONTRACT_VERSION, hostVersion }
        : { kind: "connected" },
    );

    // Then ONE call mirrors the live DATA: the `awareness` collection (the rows)
    // and the `activity` stream (the live green dot). `mirrorRemoteSurface`
    // settles when every subscription does — i.e. the link closed; if we didn't
    // dispose on purpose, the box went away, so flip the header to unreachable
    // while the other hosts keep updating (the negative-proof path).
    await mirrorRemoteSurface(
      arivuSurface,
      conn.client,
      {
        collections: {
          awareness: {
            upsert: (id, value) => opts.sink.upsert(host.label, id, value),
            remove: (id) => opts.sink.remove(host.label, id),
          },
        },
        streams: {
          activity: {
            input: {},
            onFrame: (live) => opts.sink.setLive(host.label, live),
          },
        },
      },
      { log: opts.log },
    );
    // The mirror returned → every subscription settled (the link closed;
    // `mirrorRemoteSurface` swallows its own per-stream errors). The box went
    // away: flip the header unless we tore it down on purpose.
    if (!isDisposed()) {
      opts.sink.setStatus(host.label, {
        kind: "unreachable",
        reason: "connection closed",
      });
    }
  } catch (err) {
    // The post-dial path threw — the version probe rejected, or the mirror's
    // own setup did. Same contract as a failed dial: this host is unreachable,
    // the others are untouched.
    if (!isDisposed()) {
      opts.sink.setStatus(host.label, {
        kind: "unreachable",
        reason: (err as Error).message,
      });
    }
  }
}

/** `fleet --json` — dial every host once, snapshot it, dispose. One-shot: no
 *  mirror, no renderer. A failed host becomes an `unreachable` snapshot rather
 *  than sinking the whole dump. Hosts dial in parallel (a cold box can't block a
 *  warm one). */
export function snapshotFleet(
  hosts: FleetHost[],
  connect: FleetConnector,
): Promise<FleetSnapshot[]> {
  return Promise.all(
    hosts.map(async (host): Promise<FleetSnapshot> => {
      let conn: Connection;
      try {
        conn = await connect(host);
      } catch (err) {
        return {
          label: host.label,
          kind: "unreachable",
          reason: (err as Error).message,
        };
      }
      try {
        // The SAME probe `runHost` gates the live header on — an empty version
        // stream throws into the catch below → this host's `unreachable`
        // snapshot, never a silently compatible-looking `ok` dump. The `--json`
        // snapshot keeps a skewed host's rows but tags them with the mismatch,
        // so a scripter gets the same skew signal the interactive board does.
        const { hostVersion, skewed } = await probeContractVersion(conn);
        const entries = await snapshotAwareness(conn.client);
        if (skewed) {
          return {
            label: host.label,
            kind: "skew",
            localVersion: ARIVU_CONTRACT_VERSION,
            hostVersion,
            entries,
          };
        }
        return { label: host.label, kind: "ok", entries };
      } catch (err) {
        // The dial succeeded but the version probe or the snapshot read rejected
        // (the link dropped mid-read, a half-open socket). One bad host must not
        // sink the whole `Promise.all` — surface it as this host's `unreachable`
        // snapshot, the same contract the live board uses, so `fleet --json`
        // still dumps every other host.
        return {
          label: host.label,
          kind: "unreachable",
          reason: (err as Error).message,
        };
      } finally {
        conn.dispose();
      }
    }),
  );
}
