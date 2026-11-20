import { PADI_SURFACE_VERSION } from "@kolu/padi-client/surface";
import type { DialAttempt } from "@kolu/surface/links/websocket";
import {
  type SubscriptionLiveness,
  subscriptionLiveness,
} from "@kolu/surface/subscriptions";
import { shellCommit } from "@kolu/surface-app/lifecycle";
import type { EntryState } from "@kolu/surface-map";
import { encodeHostKey } from "kolu-common/hostKey";
import { match } from "ts-pattern";
import { localDaemonStatus, type PadiEntry } from "./kaval/useDaemonStatus";
import { serverProcessId } from "./rpc/rpc";
import { hostKeys, padiMap, wire, wireDiagnostics } from "./wire";
import { probeLog } from "./wireProbes";

export const UNKNOWN = "unknown";

/** What the client believes about ONE fenced subscription, plus the verdict the
 *  snapshot computes for it. */
export interface SubscriptionRow extends SubscriptionLiveness {
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
   *  `unobservable` / `not-a-member`. */
  readonly kind: EntryState["kind"];
  /** The narration the client is showing for it: the live arms' connection
   *  `phase`, a failed arm's `reason`, or the last word an `unobservable` arm
   *  heard before this browser went blind. */
  readonly detail: string;
  /** When this entry's own status subscription last delivered a frame.
   *  `undefined` ⇒ no frame has ever landed for this entry. */
  readonly lastUpdateAt: number | undefined;
}

/** The whole snapshot, in the order it is rendered. */
export interface DiagnosticSnapshot {
  readonly capturedAt: number;
  readonly build: {
    /** `"dev"` when the shell carries no stamp. */
    readonly clientCommit: string;
    readonly serverCommit: string | undefined;
    readonly serverVersion: string | undefined;
    /** The padi surface contract this BROWSER bundle was built against. */
    readonly padiSurfaceVersion: string;
    readonly daemonContractVersion: string | undefined;
  };
  readonly wire: {
    readonly status: string;
    readonly serverProcessId: string | undefined;
    readonly epoch: number;
    /** When the CURRENT socket opened; `undefined` while the wire is not
     *  open. Every parked verdict is measured against this one instant. */
    readonly openSince: number | undefined;
    readonly lastProbeAt: number | undefined;
    readonly lastProbeOk: boolean | undefined;
    readonly lastStaleAt: number | undefined;
    /** When the SERVER retired this tab. `undefined` ⇒ still bound to the
     *  process that served this page. */
    readonly retiredAt: number | undefined;
    readonly dials: readonly DialAttempt[];
  };
  readonly subscriptions: readonly SubscriptionRow[];
  readonly hosts: readonly HostEntryRow[];
}

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

export function subscriptionVerdict(
  record: SubscriptionLiveness,
  openSince: number | undefined,
): SubscriptionVerdict {
  if (record.state === "failed") return "failed";
  if (record.state === "ended") return "ended";
  if (openSince === undefined) return "unknown";
  if (record.subscribedAt >= openSince)
    return record.lastFrameAt === undefined ? "warming" : "live";
  return record.lastFrameAt !== undefined && record.lastFrameAt >= openSince
    ? "live"
    : "parked";
}

export function collectDiagnosticSnapshot(
  inputs: DiagnosticSnapshotInputs = {},
): DiagnosticSnapshot {
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
      retiredAt: probes.retiredAt,
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
        lastUpdateAt: lastFrameByLabel.get(`entries[${enc}]`),
      };
    }),
  };
}

export interface DiagnosticSnapshotInputs {
  readonly serverBuild?: {
    readonly commit?: string;
    readonly version?: string;
  };
}

function detailOf(state: PadiEntry): string {
  return match(state)
    .with({ kind: "connected" }, { kind: "warming" }, (s) =>
      s.connection === undefined ? UNKNOWN : s.connection.phase,
    )
    .with({ kind: "failed" }, (s) => s.failure.reason)
    .with(
      { kind: "unobservable" },
      (s) => `unobservable (last published: ${s.published})`,
    )
    .with({ kind: "not-a-member" }, () => UNKNOWN)
    .exhaustive();
}

function at(ms: number | undefined): string {
  return ms === undefined ? UNKNOWN : new Date(ms).toISOString();
}

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
  lines.push(`server retired this tab: ${ago(snap.wire.retiredAt, now)}`);
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

export function buildDiagnosticSnapshotText(
  inputs?: DiagnosticSnapshotInputs,
): string {
  return formatDiagnosticSnapshot(collectDiagnosticSnapshot(inputs));
}
