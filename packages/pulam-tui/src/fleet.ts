/**
 * The `pulam-tui fleet` orchestrator — fan a one-shot dial over N hosts, LIVE-
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
 * pulam surface — the `version` cell (skew gate), the `awareness` collection
 * (the rows), and the `activity` stream (the live green dot) — into the sink in
 * one shot; the (host, terminalId) keying is the consumer's job and lives here.
 * The same primitive the kolu R-2 fold and the `remote-process-monitor` demo use.
 */

import {
  TERMINAL_WORKSPACE_CONTRACT_VERSION,
  terminalWorkspaceSurface,
  type AwarenessValue,
  type LocalGitStatus,
  type TerminalId,
} from "@kolu/terminal-workspace/surface";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import type { ArivuClient, Connection } from "./connect.ts";
import type { FleetHost } from "./hosts.ts";
import { snapshotAwareness } from "./read.ts";
import type { FleetHostStatus, FleetSnapshot } from "./fleetTypes.ts";

/** Dials one host's pulam, returning the contract-typed connection. Injected so
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
  /** The latest live working-tree status for a repo on this host, keyed by repo
   *  root path (shared across the repo's terminals) — the getStatus re-query a
   *  `subscribeRepoChange` pulse drove (R4.7). The fleet requests `mode: "local"`
   *  only, so this is the `local` arm of the status union. */
  setGitStatus: (
    label: string,
    repoPath: string,
    status: LocalGitStatus,
  ) => void;
  /** Drop a repo's git status — its last terminal left, so nothing references it.
   *  Distinct from `clearHost` (which drops the whole host on a link drop): a
   *  repo can stop being watched while the host stays up. */
  clearGitStatus: (label: string, repoPath: string) => void;
  /** Drop every mirrored row and the live set for this host, leaving only its
   *  status. Called when the link closes/fails: the mirrored data is now STALE
   *  (the box is gone), so it must not keep being counted, animated, or alerted
   *  on. The no-fallback rule — an `unreachable` host shows its header, never a
   *  frozen snapshot of `working`/`awaiting you` rows from before it died. */
  clearHost: (label: string) => void;
}

/** Owns the per-repo "subscribe to `{seq}` pulses → re-query `getStatus` → push
 *  the result into the sink" loops for ONE host, ref-counted by repo root so N
 *  terminals in a repo share one subscription and the last to leave tears it
 *  down. The hard volatility (watcher backend, reconnect) already lives upstream
 *  in the surface stream + `mirrorRemoteSurface`; this is just the bounded
 *  consumer-side lifecycle the fleet board needs (R4.7) — start a watch on a
 *  repo's first terminal, abort it on the last, and abort everything when the
 *  host's link drops (`dispose`). Solid-free, so it's unit-tested with a fake
 *  client; `fleet.tsx` never sees it. Exported only for that unit test. */
export class RepoWatchSet {
  private readonly refs = new Map<string, number>();
  private readonly stops = new Map<string, () => void>();

  constructor(
    private readonly deps: {
      client: ArivuClient;
      label: string;
      sink: FleetSink;
      log: (line: string) => void;
    },
  ) {}

  /** A terminal entered `repoPath`: start its watch loop on the 0→1 transition. */
  retain(repoPath: string): void {
    const n = (this.refs.get(repoPath) ?? 0) + 1;
    this.refs.set(repoPath, n);
    if (n === 1) this.stops.set(repoPath, this.watch(repoPath));
  }

  /** A terminal left `repoPath`: stop the loop + drop its status on the 1→0
   *  transition (a still-referenced repo keeps watching). */
  release(repoPath: string): void {
    const n = (this.refs.get(repoPath) ?? 0) - 1;
    if (n > 0) {
      this.refs.set(repoPath, n);
      return;
    }
    this.refs.delete(repoPath);
    this.stops.get(repoPath)?.();
    this.stops.delete(repoPath);
    this.deps.sink.clearGitStatus(this.deps.label, repoPath);
  }

  /** Abort every watch loop — the host's link closed or the board quit.
   *  Idempotent. */
  dispose(): void {
    for (const stop of this.stops.values()) stop();
    this.stops.clear();
    this.refs.clear();
  }

  private watch(repoPath: string): () => void {
    const abort = new AbortController();
    void this.run(repoPath, abort.signal);
    return () => abort.abort();
  }

  private async run(repoPath: string, signal: AbortSignal): Promise<void> {
    const { client, label, sink, log } = this.deps;
    try {
      // Each pulse — including the `{seq:0}` snapshot at subscribe — re-queries
      // getStatus. The pulse is a payload-free change signal, so the procedure
      // is the source of truth: this IS the pulse-plus-requery loop kolu's
      // remote Code tab will run, exercised end-to-end over a real link (R4.7).
      for await (const _pulse of await client.surface.subscribeRepoChange.get(
        { repoPath },
        { signal },
      )) {
        try {
          const status = await client.surface.git.getStatus(
            { repoPath, mode: "local" },
            { signal },
          );
          // We requested `mode: "local"`, so the result is the union's `local`
          // arm. Assert it rather than degrade — a non-local result here is a
          // contract violation (the discriminator we sent was ignored), which
          // must SURFACE, never silently render as an empty git cell.
          if (status.mode !== "local") {
            throw new Error(
              `getStatus(${repoPath}) on ${label} returned mode=${status.mode} for a local request`,
            );
          }
          // If the repo was released (last terminal left) while this re-query was
          // in flight, `release` already cleared it — don't re-add a stale status.
          if (signal.aborted) return;
          sink.setGitStatus(label, repoPath, status);
        } catch (err) {
          // A transient getStatus failure (a git lock mid-rebase, say) must not
          // tear down a long-lived subscription — the next pulse retries, and
          // the last good status stays put rather than collapsing to empty.
          log(
            `pulam-tui: getStatus(${repoPath}) on ${label} failed: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      // The subscription ended: an intentional abort (release/dispose) or the
      // host's link dropping (handled by the host's clearHost). Either way just
      // stop — surfaced via log when it wasn't our own abort, never a silent
      // collapse to an empty board.
      if (!signal.aborted) {
        log(
          `pulam-tui: subscribeRepoChange(${repoPath}) on ${label} ended: ${(err as Error).message}`,
        );
      }
    }
  }
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
    "pulam version cell yielded no snapshot frame — the host surface stream ended empty (link or protocol failure)",
  );
  return {
    hostVersion: version.contractVersion,
    // Use the framework's `major.minor` predicate, not raw string inequality: an
    // additive host (a newer minor — e.g. one that grew the `activity` stream)
    // is compatible, not skew. A lower minor or a major mismatch is skew.
    skewed: !isContractVersionCompatible(
      version.contractVersion,
      TERMINAL_WORKSPACE_CONTRACT_VERSION,
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

  // The per-repo git-status watcher set for this host (R4.7), driven off the
  // awareness deltas below: a terminal entering a repo retains a watch, leaving
  // it releases one (ref-counted, so repo mates share a single subscription),
  // and the whole set is aborted when the host's link drops.
  const watches = new RepoWatchSet({
    client: conn.client,
    label: host.label,
    sink: opts.sink,
    log: opts.log,
  });
  const repoOf = new Map<TerminalId, string>();
  const onAwarenessUpsert = (id: TerminalId, value: AwarenessValue): void => {
    opts.sink.upsert(host.label, id, value);
    // Reconcile this terminal's repo membership: a terminal whose cwd moved can
    // switch repos, so release the old watch before retaining the new one.
    const next = value.git?.repoRoot ?? null;
    const prev = repoOf.get(id) ?? null;
    if (prev === next) return;
    if (prev !== null) watches.release(prev);
    if (next !== null) {
      repoOf.set(id, next);
      watches.retain(next);
    } else {
      repoOf.delete(id);
    }
  };
  const onAwarenessRemove = (id: TerminalId): void => {
    opts.sink.remove(host.label, id);
    const prev = repoOf.get(id);
    if (prev !== undefined) {
      watches.release(prev);
      repoOf.delete(id);
    }
  };

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
    // compatibility gate, not live data (pulam is ephemeral; its version never
    // changes mid-connection), so it's a one-shot probe — an empty stream throws
    // into the catch below as this host's `unreachable`, never a silent collapse
    // to connected. (This is why the cell is probed, not folded into the mirror:
    // a mirror swallows per-stream blips, but the handshake must surface.)
    const { hostVersion, skewed } = await probeContractVersion(conn);
    opts.sink.setStatus(
      host.label,
      skewed
        ? {
            kind: "skew",
            localVersion: TERMINAL_WORKSPACE_CONTRACT_VERSION,
            hostVersion,
          }
        : { kind: "connected" },
    );

    // Then ONE call mirrors the live DATA: the `awareness` collection (the rows)
    // and the `activity` stream (the live green dot). `mirrorRemoteSurface`
    // settles when every subscription does — i.e. the link closed; if we didn't
    // dispose on purpose, the box went away, so flip the header to unreachable
    // while the other hosts keep updating (the negative-proof path).
    await mirrorRemoteSurface(
      terminalWorkspaceSurface,
      conn.client,
      {
        collections: {
          awareness: {
            upsert: onAwarenessUpsert,
            remove: onAwarenessRemove,
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
    ).done;
    // The host's link settled — abort every per-repo git-status watch too. Their
    // streams ride the same link (so they're ending anyway), but dispose stops
    // any still mid-requery and clears the ref counts.
    watches.dispose();
    // The mirror returned → every subscription settled (the link closed;
    // `mirrorRemoteSurface` swallows its own per-stream errors). The box went
    // away: flip the header AND drop its now-stale rows + live set unless we tore
    // it down on purpose — a dead host must not keep showing (and counting, and
    // alerting on) the terminals it had before the link dropped.
    if (!isDisposed()) {
      opts.sink.clearHost(host.label);
      opts.sink.setStatus(host.label, {
        kind: "unreachable",
        reason: "connection closed",
      });
    }
  } catch (err) {
    // The post-dial path threw — the version probe rejected, or the mirror's
    // own setup did. Stop any git-status watches that started, then surface the
    // host as unreachable.
    watches.dispose();
    // Same contract as a failed dial: this host is unreachable, its stale rows
    // are cleared, the others are untouched. (A throw before any upsert leaves
    // nothing to clear; clearing is idempotent either way.)
    if (!isDisposed()) {
      opts.sink.clearHost(host.label);
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
            localVersion: TERMINAL_WORKSPACE_CONTRACT_VERSION,
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
