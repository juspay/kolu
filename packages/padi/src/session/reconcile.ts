import type {
  SavedActiveTerminal,
  SavedSession,
  SavedSleepingTerminal,
} from "@kolu/padi-client/surface";
import type { PtyHostListEntry } from "kaval";

export type ReconcileStep =
  | { kind: "adopt"; record: SavedActiveTerminal; live: PtyHostListEntry }
  | { kind: "seedSleeping"; record: SavedSleepingTerminal };

export interface ReconcileResult {
  plan: ReconcileStep[];
  adoptOrphans: PtyHostListEntry[];
  reapSleeping: PtyHostListEntry[];
}

export function reconcile(
  live: readonly PtyHostListEntry[],
  saved: SavedSession | null,
): ReconcileResult {
  const liveById = new Map(live.map((entry) => [entry.id, entry]));
  const savedTerminals = saved?.terminals ?? [];
  const savedIds = new Set(savedTerminals.map((terminal) => terminal.id));
  const sleepingIds = new Set(
    savedTerminals
      .filter((terminal) => terminal.state === "sleeping")
      .map((terminal) => terminal.id),
  );
  const plan: ReconcileStep[] = [];
  for (const record of savedTerminals) {
    if (record.state === "sleeping") {
      plan.push({ kind: "seedSleeping", record });
      continue;
    }
    if (record.state !== "active") continue;
    const liveEntry = liveById.get(record.id);
    if (liveEntry) plan.push({ kind: "adopt", record, live: liveEntry });
  }
  return {
    plan,
    adoptOrphans: live.filter((entry) => !savedIds.has(entry.id)),
    reapSleeping: live.filter((entry) => sleepingIds.has(entry.id)),
  };
}
