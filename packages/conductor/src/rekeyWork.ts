/**
 * A WORK RE-KEYED, AND EVERYTHING IN THE CONVERSATION THAT POINTS AT IT —
 * the host's re-key ({@link rekeyWork}), one function the host calls and
 * its test drives, so a follower left out fails the test.
 *
 * Two fields in a row are pointers at a work, and both follow it: a
 * `work-ask` row's `work` (the work the question is about, which the card
 * answers it through) and a user row's work mention (the chip that opens
 * the card). Everything else in a row is what somebody SAID — kolu's wake
 * text, the agent's words, a `given:<id>` ask id, which is a name minted
 * once — and history is not rewritten. News held about the work follows
 * it too (`Wakes.workMoved`).
 */

import type { ConductorRow } from "kolu-common/conductor";
import type { WorkId } from "kolu-work";
import type { Wakes } from "./wakes.ts";
import type { RekeyDone, WorkStore } from "./workStore.ts";

/** What a re-key carries along beside the work store's own move. */
export interface RekeyFollowers {
  readonly works: Pick<WorkStore, "rekey">;
  /** The conversation's rows as they stand, and the write that upserts. */
  readonly rows: () => ReadonlyArray<ConductorRow>;
  readonly upsertRows: (rows: ReadonlyArray<ConductorRow>) => void;
  readonly news: Pick<Wakes, "workMoved">;
  readonly publishState: () => void;
}

/** RE-KEY A WORK TO THE ROOT GIT NAMED, and carry the conversation along:
 *  the work store's re-key (members, Code view, live PR, kept files), then,
 *  for a move, the rows that point at the work and the news held about it. */
export const rekeyWork = async (
  followers: RekeyFollowers,
  id: WorkId,
  root: string,
): Promise<RekeyDone> => {
  const done = await followers.works.rekey(id, root);
  if (done.kind !== "moved") return done;
  const upserts = rowsMovedTo(followers.rows(), id, done.to);
  if (upserts.length > 0) followers.upsertRows(upserts);
  followers.news.workMoved(id, done.to);
  followers.publishState();
  return done;
};

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
