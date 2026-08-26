/** Reproject padi-stamped epochs onto the browser clock.
 *
 *  0 is an IN-BAND sentinel across these epochs ("no activity yet" for
 *  `lastActivityAt`; ABSENT for `startedAt`/`sleptAt`), NOT an epoch — so it
 *  must NOT be reprojected (`toLocal(0)` = `-offset` forges garbage). Only a
 *  real non-zero epoch is a host-clock value to translate.
 *
 *  Shared by active-host metadata and the fleet switcher index so sentinel
 *  rules cannot drift. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";

export function reprojectTerminalClock(
  toLocal: (epoch: number) => number | null,
  record: TerminalMetadata,
): TerminalMetadata {
  const lastActivityAt = record.lastActivityAt
    ? (toLocal(record.lastActivityAt) ?? undefined)
    : record.lastActivityAt;
  const agent =
    "agent" in record && typeof record.agent?.startedAt === "number"
      ? {
          ...record.agent,
          startedAt: record.agent.startedAt
            ? (toLocal(record.agent.startedAt) ?? 0)
            : record.agent.startedAt,
        }
      : "agent" in record
        ? record.agent
        : undefined;
  const sleptAt =
    "sleptAt" in record && typeof record.sleptAt === "number"
      ? record.sleptAt
        ? (toLocal(record.sleptAt) ?? 0)
        : record.sleptAt
      : undefined;
  return {
    ...record,
    lastActivityAt,
    ...(agent === undefined ? {} : { agent }),
    ...(sleptAt === undefined ? {} : { sleptAt }),
  } as TerminalMetadata;
}
