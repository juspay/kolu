/**
 * WHERE A WORK'S CODE VIEW STANDS lives exactly as long as its work. A write
 * equal to what is held is dropped (the browser reports on every file click),
 * and a view goes the moment its work goes — by each of the three ways a work
 * can: the finished list's cap, a declined card, a restored backup that lacks
 * it.
 */

import type { WorkCodeView } from "kolu-common/works";
import type { WorkId } from "kolu-work";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memberStore } from "./memberStore.ts";
import type { RecordWrites } from "./recordWrites.ts";
import { workCodeViewStore } from "./workCodeViewStore.ts";
import { FINISHED_KEPT, workStore } from "./workStore.ts";

const LOCAL: WorkCodeView = {
  codeMode: "local",
  selectedFileByMode: { local: "src/ledger.rs" },
};

const records = <K extends string>(): RecordWrites<K> & {
  readonly scheduled: () => number;
} => {
  let scheduled = 0;
  return {
    schedule: () => {
      scheduled += 1;
    },
    now: () => {
      scheduled += 1;
    },
    flush: () => {},
    scheduled: () => scheduled,
  };
};

/** A work store over a view store, with every side the views do not care
 *  about stubbed — and every view publication kept. */
function rig() {
  const published: Array<{ id: WorkId; view: WorkCodeView | null }> = [];
  const viewRecords = records<"workCodeViews">();
  const views = workCodeViewStore({
    records: viewRecords,
    publish: (id, view) => published.push({ id, view }),
  });
  const works = workStore({
    workFiles: {
      list: async () => ({ paths: [], more: false }),
      keep: async () => ({ kept: [], tooBig: [] }),
      sweep: async () => {},
    },
    publishWork: () => {},
    publishMember: () => {},
    publishReading: () => {},
    worksMoved: () => {},
    watchScopeMoved: () => {},
    ended: () => {},
    noTerminals: () => {},
    records: records<"works" | "members">(),
    members: memberStore(),
    views,
    log: { warn: () => {} } as unknown as Logger,
  });
  const open = (branch: string): WorkId =>
    works.openFor({
      key: { kind: "branch", host: "local", repo: "/srv/code/kestrel", branch },
      title: branch,
      request: { kind: "none" },
    }).id;
  return { views, works, published, viewRecords, open };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a work's Code view", () => {
  it("drops a write equal to what it holds", () => {
    const r = rig();
    const id = r.open("export");
    r.views.set(id, LOCAL);
    const writes = r.viewRecords.scheduled();
    const published = r.published.length;

    r.views.set(id, {
      codeMode: "local",
      selectedFileByMode: { local: "src/ledger.rs" },
    });

    expect(r.viewRecords.scheduled()).toBe(writes);
    expect(r.published).toHaveLength(published);
    expect(r.views.read()).toEqual({ [id]: LOCAL });
  });

  it("goes with a declined work", () => {
    const r = rig();
    const id = r.open("export");
    r.views.set(id, LOCAL);

    expect(r.works.declined(id)).toBe(true);

    expect(r.views.read()).toEqual({});
    expect(r.published.at(-1)).toEqual({ id, view: null });
  });

  it("goes with a finished work that falls off the kept list", () => {
    vi.useFakeTimers();
    const r = rig();
    const ids: WorkId[] = [];
    for (let i = 0; i <= FINISHED_KEPT; i++) ids.push(r.open(`b${i}`));
    const [oldest, newest] = [ids[0], ids[FINISHED_KEPT]];
    if (oldest === undefined || newest === undefined)
      throw new Error("no works");
    r.views.set(oldest, LOCAL);
    r.views.set(newest, LOCAL);

    // Ended one after another, so the first is the oldest finished work.
    ids.forEach((id, i) => {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 9, 0, i)));
      r.works.stop(id, "you");
    });

    expect(r.works.get(oldest)._tag).toBe("None");
    expect(Object.keys(r.views.read())).toEqual([newest]);
    expect(r.published).toContainEqual({ id: oldest, view: null });
  });

  it("goes with a work a restored backup does not have", () => {
    const r = rig();
    const gone = r.open("export");
    const kept = r.open("import");
    r.views.set(gone, LOCAL);
    const snapshot = r.works.persisted();

    r.works.restore(
      { [kept]: snapshot[kept] as never },
      {},
      { [gone]: LOCAL, [kept]: LOCAL },
    );

    expect(r.views.read()).toEqual({ [kept]: LOCAL });
    expect(r.published.at(-1)).toEqual({ id: gone, view: null });
  });
});
