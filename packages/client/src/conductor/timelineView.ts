import { Option } from "effect";
import {
  childFolderOf,
  type Filed,
  type StageName,
  type Stages,
  WATERFALL_DIR,
  type Work,
} from "kolu-work";

export const WATCH_EVENTS_SHOWN = 5;

export type TimelineView =
  | { readonly kind: "stage"; readonly stage: Filed }
  | { readonly kind: "latest" }
  | { readonly kind: "whole" };

export type TimelineRow =
  | { readonly kind: "event"; readonly index: number }
  | {
      readonly kind: "folder";
      readonly folder: string;
      readonly indices: ReadonlyArray<number>;
    };

export const rowKey = (row: TimelineRow): string =>
  row.kind === "event" ? `e${row.index}` : `f${row.indices[0]}`;

export interface TimelineShown {
  readonly view: TimelineView;
  readonly folded: Exclude<TimelineView, { readonly kind: "whole" }>;
  readonly rows: ReadonlyArray<TimelineRow>;
  readonly total: number;
}

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

export function timelineShown(
  work: Work,
  stages: Stages,
  pressed: StageName | undefined,
  whole: boolean,
): TimelineShown {
  const all = work.events
    .map((_, index) => index)
    .filter((index) => !repeats(work, index));
  const every = rowsOf(work, all);
  const total = every.length;
  if (stages.kind !== "staged") {
    const folded = { kind: "latest" } as const;
    return whole
      ? { view: { kind: "whole" }, folded, rows: every, total }
      : {
          view: folded,
          folded,
          rows: every.slice(-WATCH_EVENTS_SHOWN),
          total,
        };
  }
  const folded = { kind: "stage", stage: pressed ?? stages.current } as const;
  return whole
    ? { view: { kind: "whole" }, folded, rows: every, total }
    : {
        view: folded,
        folded,
        rows: rowsOf(
          work,
          all.filter((index) => stages.events[index] === folded.stage),
        ),
        total,
      };
}
