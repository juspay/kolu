import type { PadiLink } from "kolu-common/surface";
import { match } from "ts-pattern";
import {
  DAEMON_UNKNOWN_DOT,
  DAEMON_UNKNOWN_LABEL,
  type DaemonLifetimeView,
  type DaemonTone,
  toneDot,
} from "../kaval/daemonPresentation";

export const PADI_LINK_PRESENTATION: Record<
  PadiLink,
  { tone: DaemonTone; label: string }
> = {
  connecting: { tone: "warming", label: "connecting…" },
  connected: { tone: "ok", label: "connected" },
  degraded: { tone: "down", label: "disconnected" },
};

export type PadiIdentityView = {
  buildCommit: string | null;
  surfaceVersion: string;
  lifetime: DaemonLifetimeView | undefined;
};

export type PadiPresence =
  | { kind: "connected"; identity: PadiIdentityView }
  | { kind: "warming" }
  | { kind: "unknown" }
  | { kind: "down" };

export function toPadiPresence(
  link: PadiLink | undefined,
  live: boolean,
  identity:
    | {
        commit: string | null;
        surfaceVersion: string;
        lifetime?: DaemonLifetimeView;
      }
    | undefined,
): PadiPresence {
  if (!live || link === undefined) return { kind: "unknown" };
  return match(link)
    .with("connecting", () => ({ kind: "warming" }) as const)
    .with("degraded", () => ({ kind: "down" }) as const)
    .with("connected", () =>
      identity === undefined
        ? ({ kind: "warming" } as const)
        : ({
            kind: "connected",
            identity: {
              buildCommit: identity.commit,
              surfaceVersion: identity.surfaceVersion,
              lifetime: identity.lifetime,
            },
          } as const),
    )
    .exhaustive();
}

export function padiPresencePresentation(presence: PadiPresence): {
  dot: string;
  label: string;
  textClass: string;
} {
  const link = presenceLink(presence);
  if (link === "unknown")
    return {
      dot: DAEMON_UNKNOWN_DOT,
      label: DAEMON_UNKNOWN_LABEL,
      textClass: "text-fg-3",
    };
  return {
    dot: toneDot[PADI_LINK_PRESENTATION[link].tone],
    label: PADI_LINK_PRESENTATION[link].label,
    textClass: "text-fg",
  };
}

export function presenceLink(presence: PadiPresence): PadiLink | "unknown" {
  return match(presence)
    .with({ kind: "unknown" }, () => "unknown" as const)
    .with({ kind: "connected" }, () => "connected" as const)
    .with({ kind: "warming" }, () => "connecting" as const)
    .with({ kind: "down" }, () => "degraded" as const)
    .exhaustive();
}

export function padiBoundHostSegment(boundHost: string | null): string | null {
  return boundHost ? `ssh · ${boundHost}` : null;
}
