/** WHICH PART OF A WORK'S TIMELINE THE PICKED WORK SHOWS — one stage of it,
 *  or one visit, until the whole is asked for. Pure, and read ONCE per redraw
 *  by the card, which hands the one answer to the map (which stage is
 *  pressed), the trail (which visit is pressed) and the timeline (which rows
 *  it draws).
 *
 *  Which stage and which visit an event is in is `kolu-work`'s own filing
 *  (`Stages`' `events` and each visit's `events`, from the walk that files
 *  the time), and which stage the work is in is its `current` — never a rule
 *  of this face's. */

import { Option } from "effect";
import {
  childFolderOf,
  type Filed,
  type StageName,
  type Stages,
  WATERFALL_DIR,
  type Work,
} from "kolu-work";

/** How many of a watch's latest rows its card shows: a watch has no stages
 *  to index its timeline by. */
export const WATCH_EVENTS_SHOWN = 5;

/** WHAT A PERSON PRESSED to choose the part of the timeline shown: a stage
 *  on the map, or one visit on the trail, by its index into the trail. */
export type TimelinePick =
  | { readonly kind: "stage"; readonly stage: StageName }
  | { readonly kind: "visit"; readonly visit: number };

/** WHAT A PICKED WORK'S TIMELINE SHOWS:
 *
 *  - `stage` — one stage's events, across every visit to it: the one pressed
 *    on the map, else the stage the work is in (for a finished work, the
 *    stage it ended in);
 *  - `visit` — the events of one visit pressed on the trail: its index, its
 *    stage, and which of that stage's visits it is (`nth` of `of`);
 *  - `latest` — a work with no stages (a watch, or a mode not chosen yet):
 *    its last {@link WATCH_EVENTS_SHOWN} rows;
 *  - `whole` — all of it, once "whole timeline" is pressed. */
export type TimelineView =
  | { readonly kind: "stage"; readonly stage: Filed }
  | {
      readonly kind: "visit";
      readonly visit: number;
      readonly stage: Filed;
      readonly nth: number;
      readonly of: number;
    }
  | { readonly kind: "latest" }
  | { readonly kind: "whole" };

/** ONE ROW OF THE TIMELINE — one event, or a run of `file` events written
 *  into one folder directly under `.waterfall/` (`Wrote mockup/ · 49 files`),
 *  which unfolds to the per-file rows. Indices are into the work's events. */
export type TimelineRow =
  | { readonly kind: "event"; readonly index: number }
  | {
      readonly kind: "folder";
      readonly folder: string;
      readonly indices: ReadonlyArray<number>;
    };

/** A ROW'S NAME, which no two rows share and which outlives a redraw — its
 *  first event, and whether it is a folder's row (a folder row and the first
 *  file row inside it start at the same event). */
export const rowKey = (row: TimelineRow): string =>
  row.kind === "event" ? `e${row.index}` : `f${row.indices[0]}`;

/** The view shown, the rows in it, the view the card folds back to from the
 *  whole one, and how many rows the whole one draws. */
export interface TimelineShown {
  readonly view: TimelineView;
  readonly folded: Exclude<TimelineView, { readonly kind: "whole" }>;
  readonly rows: ReadonlyArray<TimelineRow>;
  readonly total: number;
}

/** WHETHER AN EVENT SAYS AGAIN WHAT THE ONE BEFORE IT SAID: a work ending as
 *  merged (or closed) right after the forge merged (or closed) that PR. The
 *  timeline draws one row for the two — the forge's, which comes first. */
const repeats = (work: Work, index: number): boolean => {
  const one = work.events[index];
  const before = work.events[index - 1];
  if (one?.kind !== "ended" || before === undefined) return false;
  switch (one.outcome.kind) {
    case "merged":
      return before.kind === "merged" && before.pr === one.outcome.pr;
    case "closed":
      return before.kind === "pr-closed" && before.pr === one.outcome.pr;
    case "stopped":
      return false;
  }
};

/** THE FOLDER A FILE ROW FOLDS INTO — the folder directly under
 *  `.waterfall/` that holds it, with the terminal that wrote it, so only a
 *  run by one terminal into one folder folds. None for every other event and
 *  for a top-level file, which never fold. */
const foldKey = (
  work: Work,
  index: number,
): { readonly folder: string; readonly by: string } | undefined => {
  const one = work.events[index];
  if (one?.kind !== "file") return undefined;
  return Option.match(childFolderOf(WATERFALL_DIR, one.path), {
    onNone: () => undefined,
    onSome: (folder) => ({
      folder,
      by: one.about.kind === "member" ? one.about.terminal : "",
    }),
  });
};

/** THE ROWS THESE EVENTS DRAW — adjacent `file` events by one terminal into
 *  one folder are one row; a folder written to once stays a plain row. */
const rowsOf = (
  work: Work,
  indices: ReadonlyArray<number>,
): ReadonlyArray<TimelineRow> => {
  const runs: Array<{
    readonly fold: { readonly folder: string; readonly by: string } | undefined;
    readonly indices: number[];
  }> = [];
  for (const index of indices) {
    const fold = foldKey(work, index);
    const last = runs.at(-1);
    if (
      fold !== undefined &&
      last?.fold !== undefined &&
      last.fold.folder === fold.folder &&
      last.fold.by === fold.by
    )
      last.indices.push(index);
    else runs.push({ fold, indices: [index] });
  }
  return runs.map(
    ({ fold, indices: run }): TimelineRow =>
      fold !== undefined && run.length > 1
        ? { kind: "folder", folder: fold.folder, indices: run }
        : { kind: "event", index: run[0] ?? 0 },
  );
};

/** THE PART THE TIMELINE FOLDS TO, and its rows: a watch's latest few, a
 *  visit pressed on the trail, or a stage — the one pressed on the map, else
 *  the one the work is in. `all` is every event index the timeline draws,
 *  `every` their rows. */
const foldedPart = (
  work: Work,
  stages: Stages,
  pressed: TimelinePick | undefined,
  all: ReadonlyArray<number>,
  every: ReadonlyArray<TimelineRow>,
): {
  readonly folded: TimelineShown["folded"];
  readonly rows: ReadonlyArray<TimelineRow>;
} => {
  if (stages.kind !== "staged")
    return {
      folded: { kind: "latest" },
      rows: every.slice(-WATCH_EVENTS_SHOWN),
    };
  // A VISIT PRESSED ON THE TRAIL: its own events, from the trail's filing.
  const visit =
    pressed?.kind === "visit" ? stages.trail[pressed.visit] : undefined;
  if (pressed?.kind === "visit" && visit !== undefined) {
    const same = stages.trail.flatMap((one, index) =>
      one.stage === visit.stage ? [index] : [],
    );
    return {
      folded: {
        kind: "visit",
        visit: pressed.visit,
        stage: visit.stage,
        nth: same.indexOf(pressed.visit) + 1,
        of: same.length,
      },
      rows: rowsOf(
        work,
        all.filter(
          (index) => index >= visit.events.from && index < visit.events.until,
        ),
      ),
    };
  }
  const stage = pressed?.kind === "stage" ? pressed.stage : stages.current;
  return {
    folded: { kind: "stage", stage },
    rows: rowsOf(
      work,
      all.filter((index) => stages.events[index] === stage),
    ),
  };
};

export function timelineShown(
  work: Work,
  stages: Stages,
  pressed: TimelinePick | undefined,
  whole: boolean,
): TimelineShown {
  const all = work.events
    .map((_, index) => index)
    .filter((index) => !repeats(work, index));
  const every = rowsOf(work, all);
  const total = every.length;
  const { folded, rows } = foldedPart(work, stages, pressed, all, every);
  return whole
    ? { view: { kind: "whole" }, folded, rows: every, total }
    : { view: folded, folded, rows, total };
}
