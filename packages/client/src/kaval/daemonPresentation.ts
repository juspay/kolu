import { DASH } from "@kolu/terminal-vocab/dash";
import { compactDelta, dualOf } from "@kolu/terminal-vocab/duration";
import type {
  DaemonState,
  DaemonStatus,
  KavalSkewVersions,
} from "@kolu/padi-client/surface";
import { match, P } from "ts-pattern";
import type { WsStatus } from "../rpc/rpc";

export type DaemonTone = "ok" | "warming" | "down";

export const DAEMON_STATE_PRESENTATION: Record<
  DaemonState,
  {
    tone: DaemonTone;
    label: string;
    canvasLabel: string;
    down: boolean;
  }
> = {
  connecting: {
    tone: "warming",
    label: "starting…",
    canvasLabel: "Connecting…",
    down: false,
  },
  connected: {
    tone: "ok",
    label: "running",
    canvasLabel: "Connected",
    down: false,
  },
  restarting: {
    tone: "warming",
    label: "restarting…",
    canvasLabel: "Restarting kaval…",
    down: false,
  },
  degraded: {
    tone: "down",
    label: "stopped (session preserved)",
    canvasLabel: "Stopped",
    down: true,
  },
  dead: {
    tone: "down",
    label: "not running",
    canvasLabel: "Not running",
    down: true,
  },
  incompatible: {
    tone: "down",
    label: "incompatible — needs update",
    canvasLabel: "Incompatible",
    down: true,
  },
};

export const toneDot: Record<DaemonTone, string> = {
  ok: "bg-ok",
  warming: "bg-warning animate-pulse",
  down: "bg-danger",
};

export const DAEMON_UNKNOWN_DOT = "bg-fg-3/50";

export const DAEMON_UNKNOWN_LABEL = "unknown";

export function formatUptime(ms: number): string {
  const d = compactDelta(ms);
  return d.kind === "unknown" ? DAEMON_UNKNOWN_LABEL : dualOf(d);
}

export function serverDot(status: WsStatus, live: boolean): string {
  const tone: DaemonTone = match(status)
    .with("connecting", () => "warming" as const)
    .with("open", () => (live ? ("ok" as const) : ("warming" as const)))
    .with("closed", () => "down" as const)
    .exhaustive();
  return toneDot[tone];
}

function isWarming(state: DaemonState | undefined): boolean {
  return state ? DAEMON_STATE_PRESENTATION[state].tone === "warming" : false;
}

export function liveWarming(
  state: DaemonState | undefined,
  live: boolean,
): boolean {
  return live && isWarming(state);
}

export type DaemonDownState =
  | { state: "dead" | "degraded" }
  | ({ state: "incompatible" } & KavalSkewVersions);

export function liveDownState(
  status: DaemonStatus | undefined,
  live: boolean,
): DaemonDownState | undefined {
  if (!live || !status) return undefined;
  return match(status)
    .with(
      { state: P.union("connecting", "connected", "restarting") },
      () => undefined,
    )
    .with({ state: P.union("dead", "degraded") }, (s) => ({ state: s.state }))
    .with({ state: "incompatible" }, (s) => ({
      state: "incompatible" as const,
      daemonVersion: s.daemonVersion,
      requiredVersion: s.requiredVersion,
    }))
    .exhaustive();
}

export function offerRestartVerb(presence: KavalPresence): boolean {
  return match(presence)
    .with({ kind: "connected" }, () => true)
    .with({ kind: "down" }, () => true)
    .with({ kind: "incompatible" }, () => false)
    .with({ kind: "warming" }, () => false)
    .with({ kind: "unknown" }, () => false)
    .exhaustive();
}

export function channelLive(
  transportLive: boolean,
  entryConnected: boolean,
): boolean {
  return transportLive && entryConnected;
}

export type KavalIdentity = NonNullable<DaemonStatus["identity"]>;

export type DaemonLifetimeView = NonNullable<DaemonStatus["lifetime"]>;

export type KavalPresence =
  | {
      kind: "connected";
      identity: KavalIdentity;
      contractVersion: string;
      startedAt: number;
      socketPath: string | undefined;
      lifetime: DaemonLifetimeView | undefined;
    }
  | { kind: "warming"; state: "connecting" | "restarting" | "connected" }
  | { kind: "unknown" }
  | { kind: "down"; state: "dead" | "degraded" }
  | { kind: "incompatible" };

export function toKavalPresence(
  status: DaemonStatus | undefined,
  live: boolean,
): KavalPresence {
  if (!live || status === undefined) return { kind: "unknown" };
  return match(status)
    .with(
      { state: P.union("dead", "degraded") },
      (s) => ({ kind: "down", state: s.state }) as const,
    )
    .with({ state: "incompatible" }, () => {
      return { kind: "incompatible" } as const;
    })
    .with(
      { state: P.union("connecting", "restarting") },
      (s) => ({ kind: "warming", state: s.state }) as const,
    )
    .with({ state: "connected" }, (s) =>
      s.identity === undefined
        ? ({ kind: "warming", state: "connected" } as const)
        : ({
            kind: "connected",
            identity: s.identity,
            contractVersion: s.contractVersion,
            startedAt: s.startedAt,
            socketPath: s.socketPath,
            lifetime: s.lifetime,
          } as const),
    )
    .exhaustive();
}

export function kavalPresencePresentation(presence: KavalPresence): {
  dot: string;
  label: string;
  textClass: string;
} {
  const state = presenceState(presence);
  if (state === "unknown")
    return {
      dot: DAEMON_UNKNOWN_DOT,
      label: DAEMON_UNKNOWN_LABEL,
      textClass: "text-fg-3",
    };
  return {
    dot: toneDot[DAEMON_STATE_PRESENTATION[state].tone],
    label: DAEMON_STATE_PRESENTATION[state].label,
    textClass: "text-fg",
  };
}

export function presenceState(
  presence: KavalPresence,
): DaemonState | "unknown" {
  return match(presence)
    .with({ kind: "unknown" }, () => "unknown" as const)
    .with({ kind: "connected" }, () => "connected" as const)
    .with({ kind: "warming" }, (p) => p.state)
    .with({ kind: "down" }, (p) => p.state)
    .with({ kind: "incompatible" }, () => "incompatible" as const)
    .exhaustive();
}

export function formatLifetime(
  lifetime: DaemonLifetimeView | undefined,
): string {
  if (lifetime === undefined) return DASH;
  return match(lifetime)
    .with({ kind: "forever" }, () => "forever")
    .with(
      { kind: "idleTimeout" },
      (l) => `idle timeout (${formatUptime(l.ms)})`,
    )
    .with({ kind: "boundToPid" }, (l) => `bound to run pid ${l.pid}`)
    .exhaustive();
}
