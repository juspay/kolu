/**
 * A WORK STORE AND ITS OBSERVER, for the tests that drive them together —
 * every outside side stubbed, and the few a test asks about kept: what was
 * published as each work's live PR, and every listing of a work's files.
 */

import type { PrResult } from "@kolu/terminal-vocab/schema";
import type { WorkId } from "kolu-work";
import type { Logger } from "pino";
import { type Observing, observing } from "./observing.ts";
import type { RecordWrites } from "./recordWrites.ts";
import { workCodeViewStore } from "./workCodeViewStore.ts";
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
}

export interface WorkRig {
  readonly works: WorkStore;
  readonly watch: Observing;
  readonly published: Array<{ id: WorkId; pr: PrResult | null }>;
  readonly files: FilesRig;
}

export function workRig(): WorkRig {
  const log = { warn: () => {}, error: () => {} } as unknown as Logger;
  const published: Array<{ id: WorkId; pr: PrResult | null }> = [];
  const files: FilesRig = { listed: [], holds: new Map() };
  const workFiles: WorkFiles = {
    list: async (at) => {
      files.listed.push(at);
      return { paths: [...(files.holds.get(at.worktree) ?? [])], more: false };
    },
    keep: async () => ({ kept: [], tooBig: [] }),
    sweep: async () => {},
  };
  const works = workStore({
    workFiles,
    publishWork: () => {},
    publishMember: () => {},
    publishReading: () => {},
    publishPr: (id, pr) => published.push({ id, pr }),
    worksMoved: () => {},
    watchScopeMoved: () => {},
    ended: () => {},
    noTerminals: () => {},
    records: records<"works" | "members">(),
    views: workCodeViewStore({
      records: records<"workCodeViews">(),
      publish: () => {},
    }),
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
    worksMoved: () => {},
    watchScopeMoved: () => {},
    flush: () => {},
    log,
  });
  return { works, watch, published, files };
}
