import type { DaemonState, DaemonStatus } from "@kolu/padi-client/surface";

export function reattachToAnnounce(
  state: DaemonState | undefined,
  adopted: number | undefined,
  adoptedAt: number | undefined,
  lastAnnouncedAt: number,
): { count: number; at: number } | null {
  if (
    state === "connected" &&
    (adopted ?? 0) > 0 &&
    typeof adoptedAt === "number" &&
    adoptedAt > lastAnnouncedAt
  ) {
    return { count: adopted!, at: adoptedAt };
  }
  return null;
}

export function announceReattach(
  status: Pick<DaemonStatus, "state" | "adopted" | "adoptedAt"> | undefined,
  lastAnnouncedAt: number,
  commit: (at: number) => void,
  notify: (count: number) => void,
): void {
  const a = reattachToAnnounce(
    status?.state,
    status?.adopted,
    status?.adoptedAt,
    lastAnnouncedAt,
  );
  if (!a) return;
  commit(a.at);
  notify(a.count);
}

export type RepairStamp = "autoRecoveredAt" | "linkRestoredAt";

export function announceRepair(
  stamp: RepairStamp,
  status: Pick<DaemonStatus, "state" | RepairStamp> | undefined,
  lastAnnouncedAt: number,
  commit: (at: number) => void,
  notify: () => void,
): void {
  if (status?.state !== "connected") return;
  const at = status[stamp];
  if (typeof at !== "number" || at <= lastAnnouncedAt) return;
  commit(at);
  notify();
}
