import type { DaemonState } from "@kolu/padi-client/surface";
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import { match, P } from "ts-pattern";
import { type LogLine, NO_LOG_LINES } from "@kolu/solid-logtail";
import { isProvisioningPhase } from "../host/connectCanvasCopy";
import type { ConnectQuiet } from "./connectTailClock";
import type { DaemonDownState } from "./daemonPresentation";

export type LogAbsence = "link-down";

export type CeilingClass = "local" | "remote-provisioning" | "remote-handshake";

export type StalledLeg = "provisioning" | "membership" | "session" | "daemon";

export type ClientStalledLeg = Exclude<StalledLeg, "provisioning">;

export type BootStalledRecovery =
  | {
      via: "connector";
      phase: ConnectPhase | undefined;
      log: readonly LogLine[];
      logAbsence: LogAbsence | undefined;
      quiet: ConnectQuiet | undefined;
    }
  | { via: "client"; leg: ClientStalledLeg };

export interface BootDescriptor {
  leg: StalledLeg;
  ceiling: CeilingClass;
  phase: ConnectPhase | undefined;
  log: readonly LogLine[];
  logAbsence: LogAbsence | undefined;
  quiet: ConnectQuiet | undefined;
}

export type BootTag =
  | { accrual: "clear" }
  | { accrual: "retain" }
  | { accrual: "accrue"; boot: BootDescriptor };

export type AccruingBootTag = Extract<BootTag, { accrual: "accrue" }>;

export type BootIdentity = Pick<BootDescriptor, "leg" | "ceiling">;

export type CanvasMode =
  | { kind: "connecting" }
  | { kind: "down"; down: DaemonDownState }
  | { kind: "host-failed" }
  | { kind: "boot-stalled"; recovery: BootStalledRecovery }
  | { kind: "warming"; daemonState: DaemonState | undefined }
  | { kind: "empty" }
  | { kind: "workspace" };

export interface Precedence {
  mode: CanvasMode;
  tag: BootTag;
}

interface EntryLivenessFacts {
  isLoading: boolean;
  daemonPending: boolean;
  isLocalHost: boolean;
}

type NotYetConnectedFacts = EntryLivenessFacts & {
  connectPhase: ConnectPhase | undefined;
  connectLog: readonly LogLine[];
  connectLogAbsence: LogAbsence | undefined;
  connectQuiet: ConnectQuiet | undefined;
};

export type CanvasFacts =
  | (NotYetConnectedFacts & {
      entry: "warming";
    })
  | (EntryLivenessFacts & {
      entry: "failed";
    })
  | (NotYetConnectedFacts & {
      entry: "not-a-member";
    })
  | (NotYetConnectedFacts & {
      entry: "unobservable";
    })
  | (EntryLivenessFacts & {
      entry: "connected";
      down: DaemonDownState | undefined;
      warming: boolean;
      daemonState: DaemonState | undefined;
      terminalCount: number;
      recordsAwaited: number;
      channelLive: boolean;
    });

const CLEAR: BootTag = { accrual: "clear" };
const RETAIN: BootTag = { accrual: "retain" };

const clear = (mode: CanvasMode): Precedence => ({ mode, tag: CLEAR });
const retain = (mode: CanvasMode): Precedence => ({ mode, tag: RETAIN });

function ceilingFor(
  isLocalHost: boolean,
  connectPhase: ConnectPhase | undefined,
): CeilingClass {
  if (isLocalHost) return "local";
  return isProvisioningPhase(connectPhase)
    ? "remote-provisioning"
    : "remote-handshake";
}

function resolvePrecedence(facts: CanvasFacts): Precedence {
  return match(facts)
    .with({ entry: "failed" }, () => clear({ kind: "host-failed" }))
    .with(
      { entry: "warming" },
      { entry: "not-a-member" },
      { entry: "unobservable" },
      (f): Precedence => {
        const leg: StalledLeg =
          f.entry === "not-a-member"
            ? "membership"
            : f.isLocalHost
              ? "daemon"
              : "provisioning";
        const tag: BootTag = {
          accrual: "accrue",
          boot: {
            leg,
            ceiling: ceilingFor(f.isLocalHost, f.connectPhase),
            phase: f.connectPhase,
            log: f.connectLog,
            logAbsence: f.connectLogAbsence,
            quiet: f.connectQuiet,
          },
        };
        const bindingUp = f.connectPhase !== undefined;
        if (bindingUp) {
          return { mode: { kind: "warming", daemonState: undefined }, tag };
        }
        if (f.isLoading || f.daemonPending) {
          return { mode: { kind: "connecting" }, tag };
        }
        return f.entry === "warming"
          ? { mode: { kind: "warming", daemonState: undefined }, tag }
          : { mode: { kind: "connecting" }, tag };
      },
    )
    .with({ entry: "connected" }, (f): Precedence => {
      if (f.isLoading || f.daemonPending) {
        const leg: StalledLeg = f.isLoading ? "session" : "daemon";
        return {
          mode: { kind: "connecting" },
          tag: {
            accrual: "accrue",
            boot: {
              leg,
              ceiling: ceilingFor(f.isLocalHost, undefined),
              phase: undefined,
              log: NO_LOG_LINES,
              logAbsence: undefined,
              quiet: undefined,
            },
          },
        };
      }
      if (f.down) return clear({ kind: "down", down: f.down });
      if (f.warming)
        return retain({ kind: "warming", daemonState: f.daemonState });
      const census: AccruingBootTag | undefined =
        f.recordsAwaited > 0 && f.channelLive
          ? {
              accrual: "accrue",
              boot: {
                leg: "session",
                ceiling: ceilingFor(f.isLocalHost, undefined),
                phase: undefined,
                log: NO_LOG_LINES,
                logAbsence: undefined,
                quiet: undefined,
              },
            }
          : undefined;
      if (f.terminalCount > 0) {
        return census
          ? { mode: { kind: "workspace" }, tag: census }
          : clear({ kind: "workspace" });
      }
      if (f.recordsAwaited > 0) {
        return census
          ? { mode: { kind: "connecting" }, tag: census }
          : retain({ kind: "connecting" });
      }
      return f.channelLive
        ? clear({ kind: "empty" })
        : retain({ kind: "connecting" });
    })
    .exhaustive();
}

function escapeSurface(boot: BootDescriptor, facts: CanvasFacts): CanvasMode {
  return match({ leg: boot.leg, isLocalHost: facts.isLocalHost })
    .with(
      { leg: "daemon", isLocalHost: true },
      (): CanvasMode => ({ kind: "down", down: { state: "dead" } }),
    )
    .with(
      { leg: "provisioning" },
      (): CanvasMode => ({
        kind: "boot-stalled",
        recovery: {
          via: "connector",
          phase: boot.phase,
          log: boot.log,
          logAbsence: boot.logAbsence,
          quiet: boot.quiet,
        },
      }),
    )
    .with(
      { leg: P.union("membership", "session", "daemon") },
      ({ leg }): CanvasMode => ({
        kind: "boot-stalled",
        recovery: { via: "client", leg },
      }),
    )
    .exhaustive();
}

export function resolveCanvasMode(
  facts: CanvasFacts,
  observation: {
    transportLive: boolean;
    exceeded: boolean;
    earnedBoot: BootIdentity | undefined;
  },
): Precedence {
  const raw = resolvePrecedence(facts);
  return match({ tag: raw.tag, ...observation })
    .with(
      { tag: { accrual: "accrue" }, exceeded: true, transportLive: true },
      ({ tag }) => ({ mode: escapeSurface(tag.boot, facts), tag }),
    )
    .with(
      {
        tag: { accrual: "accrue" },
        exceeded: true,
        earnedBoot: P.not(undefined),
      },
      ({ tag, earnedBoot }) => {
        const earned: AccruingBootTag = {
          accrual: "accrue",
          boot: { ...tag.boot, ...earnedBoot },
        };
        return { mode: escapeSurface(earned.boot, facts), tag: earned };
      },
    )
    .with({ transportLive: false }, () => clear(raw.mode))
    .with({ tag: { accrual: P.union("accrue", "retain", "clear") } }, () => raw)
    .exhaustive();
}
