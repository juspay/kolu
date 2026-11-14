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
  // The agent is ALWAYS copied, never handed through. The caller reconciles this
  // value into a second store (`useTerminalMetadata`'s projection), and Solid's
  // `reconcile` unwraps whatever it is given: a raw store proxy placed here becomes
  // the SAME underlying object in both stores, signal nodes and all. The next
  // reprojection then writes its translated `startedAt` into the RAW record, which
  // re-runs the reprojection, which translates it again — an endless ping-pong
  // Solid aborts as "Potential Infinite Loop Detected", killing the metadata
  // subscription. Handing the agent through raw only when it had no `startedAt`
  // was exactly that trap, sprung the moment such an agent gained one: an agent
  // seen before its session (`startedAt: null`) whose transcript then landed.
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
