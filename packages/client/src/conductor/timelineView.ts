/** WHICH PART OF A WORK'S TIMELINE AN OPEN CARD SHOWS — one stage of it,
 *  until the whole is asked for. Pure, and read ONCE per redraw by the card,
 *  which hands the one answer to the strip (which cell is pressed) and to the
 *  timeline (which rows it draws).
 *
 *  Which stage an event is in is `kolu-work`'s own filing (`Stages`'
 *  `events`, from the walk that files the time), and which stage the work is
 *  in is its `current` — never a rule of this face's. */

import type { StageName, Stages, Work } from "kolu-work";

/** How many of a watch's latest events its card shows: a watch has no
 *  stages to index its timeline by. */
export const WATCH_EVENTS_SHOWN = 5;

/** WHAT AN OPEN CARD'S TIMELINE SHOWS:
 *
 *  - `stage` — one stage's events: the one pressed on the strip, else the
 *    stage the work is in (for a finished work, the stage it ended in);
 *  - `latest` — a work with no stages (a watch, or a mode not chosen yet):
 *    its last {@link WATCH_EVENTS_SHOWN} events;
 *  - `whole` — all of it, once "whole timeline" is pressed. */
export type TimelineView =
  | { readonly kind: "stage"; readonly stage: StageName }
  | { readonly kind: "latest" }
  | { readonly kind: "whole" };

/** The view shown, the events in it (their indices in the timeline), and
 *  the view the card folds back to from the whole one. */
export interface TimelineShown {
  readonly view: TimelineView;
  readonly folded: Exclude<TimelineView, { readonly kind: "whole" }>;
  readonly indices: ReadonlyArray<number>;
}

export function timelineShown(
  work: Work,
  stages: Stages,
  pressed: StageName | undefined,
  whole: boolean,
): TimelineShown {
  const all = work.events.map((_, index) => index);
  if (stages.kind !== "staged") {
    const folded = { kind: "latest" } as const;
    return whole
      ? { view: { kind: "whole" }, folded, indices: all }
      : { view: folded, folded, indices: all.slice(-WATCH_EVENTS_SHOWN) };
  }
  const folded = { kind: "stage", stage: pressed ?? stages.current } as const;
  return whole
    ? { view: { kind: "whole" }, folded, indices: all }
    : {
        view: folded,
        folded,
        indices: all.filter((index) => stages.events[index] === folded.stage),
      };
}
