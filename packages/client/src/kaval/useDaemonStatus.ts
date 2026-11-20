import {
  type DaemonStatus,
  encodeHostLocation,
  LOCAL_LOCATION,
  rosterIsEstablished,
} from "@kolu/padi-client/surface";
import type { EntryState } from "@kolu/surface-map";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { PadiLink } from "kolu-common/surface";
import type {
  ConnectionInfo,
  EntryFailedCause,
  PadiEntryFailure,
} from "kolu-common/surfacesWithPadi";
import { createEffect, createMemo, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { activeScope } from "../hostScope/hostScopes";
import { persistedPref } from "../persistedPref";
import type { LogLine } from "@kolu/solid-logtail";
import { activeHost, app, padiMap } from "../wire";
import {
  channelLive,
  type DaemonDownState,
  type KavalPresence,
  liveDownState,
  liveWarming,
  toKavalPresence,
} from "./daemonPresentation";
import { announceReattach, announceRepair } from "./reattachAnnounce";

export {
  DAEMON_STATE_PRESENTATION,
  DAEMON_UNKNOWN_DOT,
  type DaemonDownState,
  type DaemonTone,
  formatUptime,
  liveDownState,
  liveWarming,
  serverDot,
} from "./daemonPresentation";

const sharedDaemonTransportLive = createSharedRoot(() =>
  createMemo(() => app.health().live),
);

export function daemonTransportLive(): boolean {
  return sharedDaemonTransportLive()();
}

function activeEntryConnected(): boolean {
  return padiMap.entry(activeHost()).state().kind === "connected";
}

export type PadiEntry = EntryState<PadiEntryFailure, ConnectionInfo>;

export function activeEntryState(): PadiEntry {
  return padiMap.entry(activeHost()).state();
}

export function failedEpisode(entry: PadiEntry):
  | {
      cause: EntryFailedCause;
      reason: string;
      log: readonly LogLine[];
    }
  | undefined {
  if (entry.kind !== "failed") return undefined;
  return {
    cause: entry.failure.cause,
    reason: entry.failure.reason,
    log: entry.evidence,
  };
}

export function isActiveHostLocal(): boolean {
  return activeHost().kind === "local";
}

export function daemonChannelLive(): boolean {
  return channelLive(daemonTransportLive(), activeEntryConnected());
}

const localDaemonEntry = () =>
  activeScope()?.wire.daemonStatus.byKey(encodeHostLocation(LOCAL_LOCATION));

export function reprojectDaemonStatus(
  host: HostKey,
  status: DaemonStatus | undefined,
): DaemonStatus | undefined {
  if (status === undefined || typeof status.startedAt !== "number")
    return status;
  const local = padiMap.entry(host).clock.toLocal(status.startedAt);
  return { ...status, startedAt: local ?? 0 };
}

export const localDaemonStatus = createRoot(() =>
  createMemo((): DaemonStatus | undefined =>
    reprojectDaemonStatus(activeHost(), localDaemonEntry()?.()),
  ),
);

const padiLinkSub = createRoot(() => app.cells.padiLink.use());

export function padiLinkState(): PadiLink | undefined {
  return padiLinkSub.value();
}

export function daemonStatusPending(): boolean {
  return localDaemonEntry()?.pending() ?? true;
}

export const activeKavalPresence = createRoot(() =>
  createMemo(
    (): KavalPresence =>
      toKavalPresence(localDaemonStatus(), daemonChannelLive()),
  ),
);

export function downState(): DaemonDownState | undefined {
  return liveDownState(localDaemonStatus(), daemonChannelLive());
}

export function daemonWarming(): boolean {
  return liveWarming(localDaemonStatus()?.state, daemonChannelLive());
}

export function daemonConnected(): boolean {
  return daemonChannelLive() && localDaemonStatus()?.state === "connected";
}

export function listIsAuthoritative(): boolean {
  const scope = activeScope();
  if (scope === undefined || !daemonConnected()) return false;
  const standing = scope.wire.roster.value();
  if (standing === undefined || !rosterIsEstablished(standing)) return false;
  const listed = scope.wire.terminalKeys();
  if (listed === undefined) return false;
  return standing.ids.every((id) => listed.includes(id));
}

export function refuseIfWarming(): boolean {
  if (daemonWarming()) {
    toast.warning("Daemon is starting — try again in a moment");
    return true;
  }
  return false;
}

createRoot(() => {
  const perHostMarks = (name: string) =>
    persistedPref<Record<string, number>>({
      name,
      fallback: {},
      parse: (raw) => {
        const v: unknown = JSON.parse(raw);
        if (v === null || typeof v !== "object" || Array.isArray(v))
          throw new Error(`not a per-host record: ${raw}`);
        for (const n of Object.values(v as Record<string, unknown>))
          if (typeof n !== "number" || !Number.isFinite(n))
            throw new Error(`non-numeric mark in ${raw}`);
        return v as Record<string, number>;
      },
      onInvalid: (err, raw) =>
        console.warn(`[kaval] ${name} corrupt (${raw}); resetting to {}:`, err),
    });

  const [reattachAnnouncedAt, setReattachAnnouncedAt] = perHostMarks(
    "kolu.kaval.reattachAnnouncedAt",
  );
  const [autoRecoveryAnnouncedAt, setAutoRecoveryAnnouncedAt] = perHostMarks(
    "kolu.kaval.autoRecoveryAnnouncedAt",
  );
  const [linkRestoredAnnouncedAt, setLinkRestoredAnnouncedAt] = perHostMarks(
    "kolu.kaval.linkRestoredAnnouncedAt",
  );
  createEffect(() => {
    const host = encodeHostKey(activeHost());
    const markFor =
      (setMarks: typeof setReattachAnnouncedAt) =>
      (mark: number): void => {
        setMarks((prev) => ({ ...prev, [host]: mark }));
      };
    announceReattach(
      localDaemonStatus(),
      reattachAnnouncedAt()[host] ?? 0,
      markFor(setReattachAnnouncedAt),
      (count) =>
        toast.info(`${count} terminal${count === 1 ? "" : "s"} reattached`),
    );
    announceRepair(
      "autoRecoveredAt",
      localDaemonStatus(),
      autoRecoveryAnnouncedAt()[host] ?? 0,
      markFor(setAutoRecoveryAnnouncedAt),
      () =>
        toast.warning(
          "kaval was unresponsive — kolu restarted it; your session is ready to restore",
        ),
    );
    announceRepair(
      "linkRestoredAt",
      localDaemonStatus(),
      linkRestoredAnnouncedAt()[host] ?? 0,
      markFor(setLinkRestoredAnnouncedAt),
      () =>
        toast.success(
          "lost the connection to kaval — kolu reconnected; your terminals kept running",
        ),
    );
  });
});
