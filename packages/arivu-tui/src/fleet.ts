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
 * collapse the fleet to empty). The mirror is the SHIPPED `mirrorRemoteCollection`
 * the kolu R-2 fold and the `remote-process-monitor` demo also use; the
 * (host, terminalId) keying is the consumer's job and lives here.
 */

import {
  ARIVU_CONTRACT_VERSION,
  type AwarenessValue,
  type TerminalId,
} from "@kolu/arivu-contract";
import { firstFrameOrUndefined } from "@kolu/surface/first-frame";
import { mirrorRemoteCollection } from "@kolu/surface-nix-host";
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
}

export interface FleetHandle {
  /** Tear every live connection down; in-flight mirrors unwind as their links
   *  close. Idempotent. */
  dispose: () => void;
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
    // Read the host's declared contract version → connected | skew. The same
    // `version` cell P2's dial probes; here we keep the value to gate the header.
    const version = await firstFrameOrUndefined(
      await conn.client.surface.version.get({}),
    );
    const hostVersion = version?.contractVersion;
    opts.sink.setStatus(
      host.label,
      hostVersion && hostVersion !== ARIVU_CONTRACT_VERSION
        ? {
            kind: "skew",
            localVersion: ARIVU_CONTRACT_VERSION,
            hostVersion,
          }
        : { kind: "connected" },
    );

    // Live mirror — `mirrorRemoteCollection` holds the keys + per-key streams
    // open and pumps every delta. It settles when the link closes; if we didn't
    // dispose on purpose, the box went away, so flip the header to unreachable
    // while the other hosts keep updating (the negative-proof path).
    await mirrorRemoteCollection<TerminalId, AwarenessValue>({
      label: `awareness@${host.label}`,
      log: opts.log,
      keys: conn.client.surface.awareness.keys({}),
      get: (key, signal) =>
        conn.client.surface.awareness.get({ key }, { signal }),
      onUpsert: (id, value) => opts.sink.upsert(host.label, id, value),
      onRemove: (id) => opts.sink.remove(host.label, id),
    });
    // The mirror returned without throwing → the keys stream closed cleanly
    // (`mirrorRemoteCollection` swallows its own stream errors). The box went
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
        // Read the host's declared contract version the SAME way `runHost`
        // gates the live header. The `--json` snapshot keeps a skewed host's
        // rows but tags them with the mismatch, so a scripter gets the same skew
        // signal the interactive board does — the symmetry the no-fallback rule
        // demands (a skewed box is visible, not silently dumped as compatible).
        const version = await firstFrameOrUndefined(
          await conn.client.surface.version.get({}),
        );
        const hostVersion = version?.contractVersion;
        const entries = await snapshotAwareness(conn.client);
        if (hostVersion && hostVersion !== ARIVU_CONTRACT_VERSION) {
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
