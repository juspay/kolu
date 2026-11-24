/** HOW A WORK'S TRAIL IS LABELLED — pure, read by the trail under a picked
 *  work's Details.
 *
 *  The trail draws EVERY visit as its own segment (`kolu-work`'s `stages`
 *  keeps them, in order); the labels under it are fewer. A run of Review and
 *  Build visits — the planner handed the work, then the implementor, round
 *  after round — is labelled ONCE (`6 review rounds · 1h 10m`), so a work
 *  reviewed six times reads as that rather than as twelve names in a row.
 *  Every other visit keeps its own label. */

import { Option } from "effect";
import { type Filed, type Visit, visitMs } from "kolu-work";

/** ONE LABEL UNDER THE TRAIL:
 *
 *  - `visit` — one visit, by its index into the trail;
 *  - `rounds` — a run of review rounds, the visits `from` up to and not
 *    including `until`: each a Review and the Build after it, the last
 *    Review alone when the work is in it now.
 *
 *  `now` says the work is in one of the label's visits. */
export type TrailLabel =
  | {
      readonly kind: "visit";
      readonly visit: number;
      readonly stage: Filed;
      readonly ms: number;
      readonly now: boolean;
    }
  | {
      readonly kind: "rounds";
      readonly from: number;
      readonly until: number;
      readonly rounds: number;
      readonly ms: number;
      readonly now: boolean;
    };

/** How few review rounds make a run worth one label: one round is a Review
 *  and a Build, which two labels say as well. */
const ROUNDS_GROUPED = 2;

/** THE LABELS of a trail, in its order. Every visit is in exactly one. */
export function trailLabels(
  trail: ReadonlyArray<Visit>,
): ReadonlyArray<TrailLabel> {
  const labels: TrailLabel[] = [];
  const open = (from: number, until: number): boolean =>
    trail.slice(from, until).some((visit) => Option.isNone(visit.until));
  let at = 0;
  while (at < trail.length) {
    // A RUN OF ROUNDS: a Review and the Build after it, again and again —
    // and a last Review, when that is where the work is.
    let end = at;
    let rounds = 0;
    while (
      trail[end]?.stage === "review" &&
      trail[end + 1]?.stage === "build"
    ) {
      rounds += 1;
      end += 2;
    }
    if (rounds > 0 && trail[end]?.stage === "review") {
      rounds += 1;
      end += 1;
    }
    if (rounds >= ROUNDS_GROUPED) {
      labels.push({
        kind: "rounds",
        from: at,
        until: end,
        rounds,
        ms: trail.slice(at, end).reduce((sum, one) => sum + visitMs(one), 0),
        now: open(at, end),
      });
      at = end;
      continue;
    }
    const visit = trail[at];
    if (visit !== undefined)
      labels.push({
        kind: "visit",
        visit: at,
        stage: visit.stage,
        ms: visitMs(visit),
        now: open(at, at + 1),
      });
    at += 1;
  }
  return labels;
}
