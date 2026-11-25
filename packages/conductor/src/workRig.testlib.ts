/**
 * A WORK STORE AND ITS OBSERVER, for the tests that drive them together —
 * every outside side stubbed, and the few a test asks about kept: what was
 * published as each work's live PR and as each work, every listing of a
 * work's files, and every sweep and move of the kept files.
 */

import type { PrResult } from "@kolu/terminal-vocab/schema";
import type { Work, WorkId } from "kolu-work";
import type { Logger } from "pino";
import { type Observing, observing } from "./observing.ts";
import type { RecordWrites } from "./recordWrites.ts";
import {
  type WorkCodeViewStore,
  workCodeViewStore,
} from "./workCodeViewStore.ts";
import type { WorkFiles } from "./workFiles.ts";
import { type WorkStore, workStore } from "./workStore.ts";

const records = <K extends string>(): RecordWrites<K> => ({
  schedule: () => {},
  now: () => {},
  flush: () => {},
});

/** Where a listing was asked, and what each folder holds. */
export interface FilesRig {
  readonly listed: Array<{ host: string; worktree: string }>;
  /** Paths under `.waterfall/`, by folder. A folder not here holds none. */
  readonly holds: Map<string, ReadonlyArray<string>>;
  /** Every sweep and every move that landed, in order. */
  readonly ops: Array<
    | { kind: "sweep"; keep: ReadonlyArray<string> }
    | { kind: "move"; from: string; to: string }
  >;
  /** Set to make every move reject, as a rename that fails would. */
  failMoves: boolean;
  /** Called as each move runs: whatever else happens while the rename
   *  does (a test queues it, as another caller's turn would come). */
  during?: () => void;
}

export interface WorkRig {
  readonly works: WorkStore;
  readonly watch: Observing;
  readonly published: Array<{ id: WorkId; pr: PrResult | null }>;
  /** Every work published, and `null` for one published gone. */
  readonly publishedWorks: Array<{ id: WorkId; work: Work | null }>;
  readonly files: FilesRig;
  readonly views: WorkCodeViewStore;
  /** Everything the store and the observer logged at error level — a
   *  defect they caught to keep going, which a test must not miss. */
  readonly errors: Array<unknown>;
}

export function workRig(): WorkRig {
  const errors: Array<unknown> = [];
  const log = {
    warn: () => {},
    error: (...args: Array<unknown>) => errors.push(args),
  } as unknown as Logger;
  const published: Array<{ id: WorkId; pr: PrResult | null }> = [];
  const publishedWorks: Array<{ id: WorkId; work: Work | null }> = [];
  const files: FilesRig = {
    listed: [],
    holds: new Map(),
    ops: [],
    failMoves: false,
  };
  const workFiles: WorkFiles = {
    list: async (at) => {
      files.listed.push(at);
      return { paths: [...(files.holds.get(at.worktree) ?? [])], more: false };
    },
    keep: async () => ({ kept: [], tooBig: [] }),
    sweep: async (keep) => {
      files.ops.push({ kind: "sweep", keep });
    },
    move: (from, to) => {
      files.during?.();
      if (files.failMoves) throw new Error(`could not rename ${from}`);
      files.ops.push({ kind: "move", from, to });
    },
  };
  const views = workCodeViewStore({
    records: records<"workCodeViews">(),
    publish: () => {},
  });
  const works = workStore({
    workFiles,
    publishWork: (id, work) => publishedWorks.push({ id, work }),
    publishMember: () => {},
    publishReading: () => {},
    publishPr: (id, pr) => published.push({ id, pr }),
    worksMoved: () => {},
    watchScopeMoved: () => {},
    ended: () => {},
    noTerminals: () => {},
    records: records<"works" | "members">(),
    views,
    log,
  });
  const watch = observing({
    store: works,
    members: works.members,
    workFiles,
    records: records<"works" | "members">(),
    ring: () => {},
    withdraw: () => false,
    handoverHeld: () => false,
    hostNamed: () => {},
    publishState: () => false,
    rekey: (id, root) => works.rekey(id, root),
    worksMoved: () => {},
    watchScopeMoved: () => {},
    flush: () => {},
    log,
  });
  return { works, watch, published, publishedWorks, files, views, errors };
}
