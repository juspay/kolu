/** Reproject padi-stamped epochs onto the browser clock. 0 is an in-band
 *  sentinel, not an epoch, and is never reprojected. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";

export function reprojectTerminalClock(
  toLocal: (epoch: number) => number | null,
  record: TerminalMetadata,
): TerminalMetadata {
  const lastActivityAt = record.lastActivityAt
    ? (toLocal(record.lastActivityAt) ?? undefined)
    : record.lastActivityAt;
  // SolidJS `reconcile` unwraps a store proxy handed to it, so a raw `agent`
  // placed here would become the same object in both stores and ping-pong the
  // reprojection ("Potential Infinite Loop Detected"). Always copy.
  const agent = !("agent" in record)
    ? undefined
    : record.agent === null
      ? null
      : {
          ...record.agent,
          startedAt: record.agent.startedAt
            ? (toLocal(record.agent.startedAt) ?? 0)
            : record.agent.startedAt,
        };
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
