/**
 * THE CONVERSATION'S ROWS THAT NAME A RE-KEYED WORK, carried to its new id.
 *
 * Two fields in a row are pointers at a work, and both follow it: a
 * `work-ask` row's `work` (the work the question is about, which the card
 * answers it through) and a user row's work mention (the chip that opens
 * the card). Everything else in a row is what somebody SAID — kolu's wake
 * text, the agent's words, a `given:<id>` ask id, which is a name minted
 * once — and history is not rewritten.
 */

import type { ConductorRow } from "kolu-common/conductor";
import type { WorkId } from "kolu-work";

/** That row with every pointer at `from` pointing at `to` — the same row
 *  object when it names `from` nowhere. */
export const rowMovedTo = (
  row: ConductorRow,
  from: WorkId,
  to: WorkId,
): ConductorRow => {
  if (row.kind === "work-ask")
    return row.work === from ? { ...row, work: to } : row;
  if (row.kind !== "user" || row.mentions === undefined) return row;
  const mentions = row.mentions;
  if (!mentions.some((one) => one.kind === "work" && one.work === from))
    return row;
  return {
    ...row,
    mentions: mentions.map((one) =>
      one.kind === "work" && one.work === from ? { ...one, work: to } : one,
    ),
  };
};

/** The rows of `rows` that name `from`, carried to `to` — the upserts a
 *  re-key puts on the wire. */
export const rowsMovedTo = (
  rows: ReadonlyArray<ConductorRow>,
  from: WorkId,
  to: WorkId,
): ReadonlyArray<ConductorRow> =>
  rows.flatMap((row) => {
    const moved = rowMovedTo(row, from, to);
    return moved === row ? [] : [moved];
  });
