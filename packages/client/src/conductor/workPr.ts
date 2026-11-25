/** A WORK'S PULL REQUEST, LIVE — and the one module in the conductor's faces
 *  that may unwrap a forge reading.
 *
 *  A work's PR is its branch's. kolu-server's watch asks the host for the PR
 *  of the work's own `(repo, branch)` and publishes the answer under the
 *  work's id (the `workPrs` collection). Nothing here reads a member
 *  terminal's record: a terminal may stand on any branch, and the PR it
 *  carries is that branch's.
 *
 *  {@link WorkPr} is a different type from "a PR": the card's mark, its check
 *  count and the Work section take one, and the only way to make one is
 *  {@link workPrOf} — from the work and the reading filed under its id. So a
 *  PR read off anything else cannot be handed to them. */

import { type PrInfo, prValue } from "anyforge/schemas";
import { Option } from "effect";
import type { PrResult } from "kolu-common/surface";
import { prOf, type Work, type WorkId } from "kolu-work";
import { type Accessor, createMemo } from "solid-js";
import { useWorkPrs } from "./useWorks";

declare const workPr: unique symbol;
/** THIS WORK'S PULL REQUEST — a PR the work's own watch read for its branch,
 *  whose number is the one the work's timeline names. */
export type WorkPr = PrInfo & { readonly [workPr]: true };

/** THE WORK'S PR, from the reading filed under its id: some only when the
 *  work is open, its key is a branch, the reading is `ok`, and its number is
 *  the one the work's own timeline names — so the mark beside the words
 *  "draft PR #7" is #7's, or nothing. Total. */
export const workPrOf = (
  work: Work,
  reading: PrResult | undefined,
): Option.Option<WorkPr> => {
  if (work.state.kind !== "open" || work.key.kind !== "branch")
    return Option.none();
  const pr = reading === undefined ? null : prValue(reading);
  if (pr === null) return Option.none();
  return Option.exists(prOf(work), (named) => named.number === pr.number)
    ? Option.some(pr as WorkPr)
    : Option.none();
};

/** THE WORK'S PR, looked up by the work's own id. It takes no reading and no
 *  member, so nothing but the work's own watch can be drawn as its PR. */
export function useWorkPr(
  id: Accessor<WorkId>,
  work: Accessor<Work>,
): Accessor<Option.Option<WorkPr>> {
  const prs = useWorkPrs();
  // The same PR object is the same answer: a reading that did not move keeps
  // its object in the mirror, so another work's PR moving redraws nothing here.
  return createMemo(
    () => workPrOf(work(), prs().get(id())),
    Option.none<WorkPr>(),
    { equals: (a, b) => Option.getOrNull(a) === Option.getOrNull(b) },
  );
}
