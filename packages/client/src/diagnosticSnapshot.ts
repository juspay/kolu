/**
 * The copy-pasteable client diagnostic snapshot (kolu#2101 J2) — everything this
 * tab believes about its own wire, in one block a user can paste into an issue.
 *
 * **The incident it exists for.** A woken tab sat on a stale card while its
 * socket, its watchdog and its header dot were all healthy: a re-dial the
 * protocol swallowed had orphaned every fenced subscription in the page, and
 * nothing on the client could say so. Diagnosing it took server-log archaeology
 * plus screenshot forensics, and the three facts that would have settled it in a
 * second — the swallowed dial, each subscription's last frame, and the wire's
 * open-since — were held by the client and exposed by nothing.
 *
 * **Two rules the whole module is built to keep.**
 *
 *  1. **No network.** The builder reads already-held client state and nothing
 *     else: the link's own dial history, the subscription liveness registry, the
 *     host map's folded entry state, the watchdog's last verdict. A diagnostic
 *     that had to ASK the server would be useless in exactly the case it exists
 *     for — a wire that is lying. It is synchronous for the same reason, plus
 *     one more: {@link writeTextToClipboard} must be reached inside the user's
 *     gesture window (`ui/clipboard.ts`), so the build has to happen inside the
 *     `Effect.suspend` that precedes the write, with no `await` before it.
 *  2. **Never fabricate.** An absent value is `"unknown"`, never a zero, never a
 *     plausible default. Half this block's job is to be read BESIDE a server log,
 *     and a fabricated field would send a reader down a false trail.
 *
 * **Format.** Plain text, fixed sections, stable field order — the mandate's
 * shape, and the one that survives being pasted into an issue, a chat, or a
 * terminal. {@link collectDiagnosticSnapshot} builds the ordered DATA and
 * {@link formatDiagnosticSnapshot} renders it, so the on-screen block and the
 * copied text derive from one structure rather than two renderings that can
 * drift.
 */

import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import type { DialAttempt } from "@kolu/surface/links/websocket";
import {
  type SubscriptionLiveness,
  subscriptionLiveness,
} from "@kolu/surface/subscriptions";
import { shellCommit } from "@kolu/surface-app/lifecycle";
import { encodeHostKey } from "kolu-common/hostKey";
import { localDaemonStatus } from "./kaval/useDaemonStatus";
import { serverProcessId } from "./rpc/rpc";
import { hostKeys, padiMap, wire, wireDiagnostics } from "./wire";
import { probeLog } from "./wireProbes";

/** The value every absent field carries. One spelling, so a reader learns it
 *  once and a grep finds every gap. */
export const UNKNOWN = "unknown";

/** What the client believes about ONE fenced subscription, plus the verdict the
 *  snapshot computes for it. */
export interface SubscriptionRow extends SubscriptionLiveness {
  /** The whole point of the block:
   *   - `parked` — this subscription was opened BEFORE the wire's current socket
   *     and has heard nothing since that socket opened. That is the production
   *     incident's exact signature, and it is invisible to `client.health()`: a
   *     parked stream is not pending (its first frame landed, long ago) and not
   *     erroring (nothing failed — that is the disease).
   *   - `live` — it has received a frame on the CURRENT socket.
   *   - `warming` — opened on the current socket, first frame not in yet.
   *   - `ended` / `failed` — the registry's own terminal states.
   *   - `unknown` — the wire is not open, so nothing can be said about staleness
   *     relative to a socket that does not exist. */
  readonly verdict: SubscriptionVerdict;
}

export type SubscriptionVerdict =
  | "live"
  | "warming"
  | "parked"
  | "ended"
  | "failed"
  | "unknown";

/** One host entry, exactly as the client currently believes it. */
export interface HostEntryRow {
  /** The canonical wire spelling of the host key. */
  readonly key: string;
  /** The folded entry state's arm — `connected` / `warming` / `failed` /
   *  `not-a-member`. */
  readonly kind: string;
  /** The narration the client is showing for it: the live arms' connection
   *  `phase`, or a failed arm's `reason`. */
  readonly detail: string;
  /** When this entry's own status subscription last delivered a frame — stamped
   *  client-side by the liveness registry (the map's per-key `entries[<key>]`
   *  sub), NOT by the wire: `surface-map`'s `EntryStatus` carries no timestamp,
   *  and widening it for a client-side need would cost every consumer of the
   *  shared package. `undefined` ⇒ no frame has ever landed for this entry. */
  readonly lastUpdateAt: number | undefined;
}

/** The whole snapshot, in the order it is rendered. */
export interface DiagnosticSnapshot {
  readonly capturedAt: number;
  readonly build: {
    /** `"dev"` when the shell carries no stamp — the shell's own honest value,
     *  passed through rather than re-spelled as unknown. */
    readonly clientCommit: string;
    readonly serverCommit: string | undefined;
    readonly serverVersion: string | undefined;
    /** The padi surface contract this BROWSER bundle was built against. */
    readonly padiSurfaceVersion: string;
    /** The contract version the active host's padi daemon reports — read off
     *  `daemonStatus`, the value the client already holds. (Deliberately not
     *  imported from kaval: the client has no business depending on the daemon's
     *  package to state a version the daemon already told it.) */
    readonly daemonContractVersion: string | undefined;
  };
  readonly wire: {
    readonly status: string;
    readonly serverProcessId: string | undefined;
    /** How many times this wire has reached `open` — a call bound to an earlier
     *  epoch was orphaned by a re-dial. */
    readonly epoch: number;
    /** When the CURRENT socket opened; `undefined` while the wire is not open.
     *  Every parked verdict below is measured against this one instant. */
    readonly openSince: number | undefined;
    readonly lastProbeAt: number | undefined;
    readonly lastProbeOk: boolean | undefined;
    readonly lastStaleAt: number | undefined;
    readonly dials: readonly DialAttempt[];
  };
  readonly subscriptions: readonly SubscriptionRow[];
  readonly hosts: readonly HostEntryRow[];
}

/** When did the CURRENT socket open? The last dial that opened and has not
 *  ended. A dial that ended (however it ended) is not the current one, and a
 *  wire that is not `open` has no current socket at all — in which case every
 *  staleness comparison below is unanswerable rather than false. */
function openSinceOf(
  dials: readonly DialAttempt[],
  status: string,
): number | undefined {
  if (status !== "open") return undefined;
  for (let i = dials.length - 1; i >= 0; i--) {
    const dial = dials[i];
    if (dial === undefined) continue;
    if (dial.endedAt !== undefined) return undefined;
    if (dial.openedAt !== undefined) return dial.openedAt;
  }
  return undefined;
}

/** The parked verdict, computed at SNAPSHOT time from the registry record and
 *  the wire's current open-since — never stored, because it is a comparison
 *  between two facts that each move on their own. */
export function subscriptionVerdict(
  record: SubscriptionLiveness,
  openSince: number | undefined,
): SubscriptionVerdict {
  if (record.state === "failed") return "failed";
  if (record.state === "ended") return "ended";
  if (openSince === undefined) return "unknown";
  // Opened ON the current socket: it cannot have been orphaned by a re-dial that
  // happened before it existed. No frame yet is honest warming, not a park.
  if (record.subscribedAt >= openSince)
    return record.lastFrameAt === undefined ? "warming" : "live";
  // Opened BEFORE the current socket. A frame since that socket opened proves
  // the re-drive happened; its absence is exactly the incident.
  return record.lastFrameAt !== undefined && record.lastFrameAt >= openSince
    ? "live"
    : "parked";
}

/** Read every fact this tab holds about its own wire. Synchronous, network-free
 *  (see the module docstring), and safe outside a reactive owner — every source
 *  is either a module-level accessor or a plain registry read. */
export function collectDiagnosticSnapshot(
  inputs: DiagnosticSnapshotInputs = {},
): DiagnosticSnapshot {
  // The LINK's own status, not the lifecycle's projection of it: `openSince`
  // (and so every parked verdict) is measured against the socket the link holds,
  // and the link is the thing that knows whether it is retired.
  const status = wire.status();
  const dials = wireDiagnostics.dialHistory();
  const openSince = openSinceOf(dials, status);
  const probes = probeLog();
  const liveness = subscriptionLiveness();
  const lastFrameByLabel = new Map<string, number | undefined>(
    liveness.map((record) => [record.label, record.lastFrameAt]),
  );
  return {
    capturedAt: Date.now(),
    build: {
      clientCommit: shellCommit(),
      serverCommit: inputs.serverBuild?.commit,
      serverVersion: inputs.serverBuild?.version,
      padiSurfaceVersion: PADI_SURFACE_VERSION,
      daemonContractVersion: localDaemonStatus()?.contractVersion ?? undefined,
    },
    wire: {
      status,
      serverProcessId: serverProcessId() ?? undefined,
      epoch: wireDiagnostics.epoch(),
      openSince,
      lastProbeAt: probes.lastProbeAt,
      lastProbeOk: probes.lastProbeOk,
      lastStaleAt: probes.lastStaleAt,
      dials,
    },
    subscriptions: liveness.map((record) => ({
      ...record,
      verdict: subscriptionVerdict(record, openSince),
    })),
    hosts: hostKeys().map((key) => {
      const enc = encodeHostKey(key);
      const state = padiMap.entry(key).state();
      return {
        key: enc,
        kind: state.kind,
        detail: detailOf(state),
        // The map's own per-key status subscription, under the name the
        // framework registers it with (`<collection>[<key>]`).
        lastUpdateAt: lastFrameByLabel.get(`entries[${enc}]`),
      };
    }),
  };
}

/** The facts the builder cannot reach on its own. `buildInfo` is a cell held by
 *  `<SurfaceAppProvider>`'s context, so a component reads it and hands it in —
 *  rather than this module opening a second subscription to the same cell, which
 *  would be a network call inside a diagnostic that promises none. */
export interface DiagnosticSnapshotInputs {
  readonly serverBuild?: {
    readonly commit?: string;
    readonly version?: string;
  };
}

/** The narration the client is currently showing for an entry — its live phase,
 *  or its failure reason. Spelled per arm rather than stringified whole: the
 *  whole state object would drown the table it belongs to. */
function detailOf(state: {
  kind: string;
  connection?: { phase?: string };
  reason?: string;
}): string {
  if (state.kind === "failed") return state.reason ?? UNKNOWN;
  return state.connection?.phase ?? UNKNOWN;
}

/** Wall clock as an ISO instant — the spelling a server log uses, so the two can
 *  be read side by side. */
function at(ms: number | undefined): string {
  return ms === undefined ? UNKNOWN : new Date(ms).toISOString();
}

/** An instant plus how long ago it was, which is what makes a frozen
 *  `last frame` legible on its face rather than by arithmetic. */
function ago(ms: number | undefined, now: number): string {
  if (ms === undefined) return UNKNOWN;
  return `${at(ms)} (${((now - ms) / 1000).toFixed(1)}s ago)`;
}

/** Render the snapshot as the plain text a user copies. Stable order, one fact
 *  per line, `unknown` wherever a value is genuinely absent. */
export function formatDiagnosticSnapshot(snap: DiagnosticSnapshot): string {
  const now = snap.capturedAt;
  const lines: string[] = [];
  lines.push("kolu diagnostic snapshot");
  lines.push(`capturedAt: ${at(now)}`);
  lines.push("");
  lines.push("[build]");
  lines.push(`client commit: ${snap.build.clientCommit}`);
  lines.push(`server commit: ${snap.build.serverCommit ?? UNKNOWN}`);
  lines.push(`server version: ${snap.build.serverVersion ?? UNKNOWN}`);
  lines.push(`padi surface version: ${snap.build.padiSurfaceVersion}`);
  lines.push(
    `daemon contract version: ${snap.build.daemonContractVersion ?? UNKNOWN}`,
  );
  lines.push("");
  lines.push("[wire]");
  lines.push(`status: ${snap.wire.status}`);
  lines.push(`server process: ${snap.wire.serverProcessId ?? UNKNOWN}`);
  lines.push(`epoch (open edges): ${snap.wire.epoch}`);
  lines.push(`open since: ${ago(snap.wire.openSince, now)}`);
  lines.push(
    `last probe: ${ago(snap.wire.lastProbeAt, now)} ${
      snap.wire.lastProbeOk === undefined
        ? UNKNOWN
        : snap.wire.lastProbeOk
          ? "answered"
          : "TIMED OUT"
    }`,
  );
  lines.push(`last stale verdict: ${ago(snap.wire.lastStaleAt, now)}`);
  lines.push(`dials (${snap.wire.dials.length}, oldest first):`);
  if (snap.wire.dials.length === 0) lines.push("  (none recorded)");
  for (const dial of snap.wire.dials) {
    lines.push(
      `  ${dial.classification} started=${at(dial.startedAt)} opened=${at(
        dial.openedAt,
      )} ended=${at(dial.endedAt)} code=${dial.closeCode ?? UNKNOWN}`,
    );
  }
  lines.push("");
  lines.push(`[subscriptions] (${snap.subscriptions.length})`);
  if (snap.subscriptions.length === 0) lines.push("  (none registered)");
  for (const sub of snap.subscriptions) {
    lines.push(
      `  ${sub.verdict.toUpperCase()} ${sub.label} subscribed=${at(
        sub.subscribedAt,
      )} lastFrame=${ago(sub.lastFrameAt, now)} frames=${
        sub.framesReceived
      } retries=${sub.retries} state=${sub.state}${
        sub.lastError === undefined ? "" : ` lastError=${sub.lastError}`
      }`,
    );
  }
  lines.push("");
  lines.push(`[hosts] (${snap.hosts.length})`);
  if (snap.hosts.length === 0) lines.push("  (none)");
  for (const host of snap.hosts) {
    lines.push(
      `  ${host.key} ${host.kind} detail=${host.detail} lastUpdate=${ago(
        host.lastUpdateAt,
        now,
      )}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Build the copy-pasteable text in one call — what both copy affordances run
 *  INSIDE their `Effect.suspend`, so the whole build happens in the gesture
 *  window with no `await` before the clipboard write. */
export function buildDiagnosticSnapshotText(
  inputs?: DiagnosticSnapshotInputs,
): string {
  return formatDiagnosticSnapshot(collectDiagnosticSnapshot(inputs));
}
