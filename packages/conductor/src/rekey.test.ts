/**
 * A WORK RE-KEYED TO GIT'S ROOT, as the host writes it — and NOTHING REMOVED.
 *
 * - T15: the host's own re-key (`rekeyWork`, the one function the host
 *   calls) carries everything that names the work — its record, its
 *   members, its Code view, the conversation's rows, the news held about it
 *   — so the old id is left only inside a `given:` ask id (a name minted
 *   once), and a question still open on it can be answered.
 * - T16: a finished work kept under a worktree path, re-keyed, is the work
 *   `openFor` of the root's key brings back — reopened, under the root's id.
 * - T27: another work holds the root's id: the old-key work stays where it
 *   was, `held`, the holder untouched — no kept-files move or sweep, and
 *   nothing published gone.
 * - Its ending, when both are open, runs no finished cap: twenty finished
 *   works and the collision leave twenty-one, and nothing is swept.
 * - A kept-files move that fails leaves the work under its old key, its
 *   folder where it was, and the next sweep removing nothing.
 * - T28: `openFor` the root's key answers the OPEN held work, under its own
 *   id; nothing is created and the finished holder stays finished.
 * - T29: Reopen is refused while another work is open on the same branch.
 * - T30: once the holder has gone, the next checkout answer moves the held
 *   work to the root's id, stamped `git`.
 */

import { setImmediate as settle } from "node:timers/promises";
import type { ConductorRow } from "kolu-common/conductor";
import { Option } from "effect";
import {
  type BranchKey,
  endWork,
  openWork,
  type Question,
  type Work,
  type WorkId,
  WorkRefusal,
  workIdOf,
} from "kolu-work";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { asking } from "./asking.ts";
import { rekeyWork } from "./rekeyWork.ts";
import { wakes } from "./wakes.ts";
import { workDirOf } from "./workFiles.ts";
import { type WorkRig, workRig } from "./workRig.testlib.ts";
import { FINISHED_KEPT } from "./workStore.ts";

const AT = "2026-11-24T19:00:00.000Z";
const ROOT = "/repo";
const WORKTREE = "/repo/.worktrees/csv";

const keyAt = (
  repo: string,
  repoBy: BranchKey["repoBy"],
  branch = "csv",
): BranchKey => ({ kind: "branch", host: "local", repo, branch, repoBy });
const GIT_KEY = {
  kind: "branch",
  host: "local",
  repo: ROOT,
  branch: "csv",
  repoBy: { kind: "git" },
} as const;
const OLD_KEY = keyAt(WORKTREE, { kind: "as-written" });
const HELD_KEY = keyAt(WORKTREE, { kind: "held", root: ROOT });
const OLD: WorkId = workIdOf(OLD_KEY);
const NEW: WorkId = workIdOf(GIT_KEY);

const opened = (key: BranchKey, title: string): Work =>
  openWork({ key, title, at: AT, request: { kind: "none" } });
const finished = (key: BranchKey, title: string): Work =>
  endWork(opened(key, title), {
    outcome: { kind: "stopped", by: "you" },
    at: AT,
  });

const rigWith = (...works: ReadonlyArray<Work>): WorkRig => {
  const r = workRig();
  r.works.load(
    Object.fromEntries(works.map((one) => [workIdOf(one.key), one])),
    {},
    {},
  );
  return r;
};
const workOf = (r: WorkRig, id: WorkId): Work =>
  Option.getOrThrow(r.works.get(id));

/** Every async step an ending's close-out takes, run out. */
const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await settle();
};

const QUESTION: Question = {
  id: "q-mode",
  question: "Which mode?",
  topic: "setup",
  key: "mode",
  options: ["full", "trivial"],
  given: { kind: "ask" },
};
const GIVEN: Question = {
  id: "q-green",
  question: "On green?",
  topic: "setup",
  key: "on-green",
  options: ["merge", "hand-over"],
  given: { kind: "given", value: "merge" },
};

describe("a re-key that moves the work", () => {
  it("carries everything that names it, leaving the old id only inside given: (T15)", async () => {
    const r = rigWith(opened(OLD_KEY, "csv export"));
    const asks = asking({
      store: r.works,
      said: () => {},
      settled: () => {},
      news: () => {},
    });
    const given = asks.put(OLD, "decided", [GIVEN]);
    const asked = asks.put(OLD, "which mode?", [QUESTION]);
    expect(given.ask).toBe(`given:${OLD}`);
    r.works.join(OLD, "local/t1", "planner", "asked");
    r.works.setCodeView(OLD, {
      codeMode: "local",
      selectedFileByMode: { local: "src/csv.ts" },
    });
    let rows: ReadonlyArray<ConductorRow> = [
      {
        kind: "user",
        id: "u1",
        seq: 1,
        since: AT,
        text: "carry on with the csv export",
        mentions: [{ kind: "work", work: OLD, title: "csv export" }],
        attachments: [],
      },
      {
        kind: "work-ask",
        id: asked.ask,
        seq: 2,
        since: AT,
        text: "which mode?",
        ask: { fields: [], standing: { kind: "open" } },
        work: OLD,
      },
    ];
    // THE NEWS HELD ABOUT IT, in a real `wakes` — an answer, and the work
    // losing its last terminal — flushed into a turn the test reads.
    const said: string[] = [];
    const news = wakes({
      turn: async () => ({
        idle: true,
        wake: async (text) => {
          said.push(text);
        },
      }),
      say: () => {},
      changed: () => {},
      membership: () => null,
      told: () => {},
      stopped: () => false,
      log: { warn: () => {}, error: () => {} } as unknown as Logger,
    });
    news.answered({
      work: OLD,
      title: "csv export",
      ask: "ask:earlier",
      at: AT,
      questions: [],
      how: "dropped",
    });
    news.noTerminals({ work: OLD, title: "csv export", at: AT });

    // THE HOST'S OWN RE-KEY, handed this test's rows and news.
    const done = await rekeyWork(
      {
        works: r.works,
        rows: () => rows,
        upsertRows: (upserts) => {
          const byId = new Map(rows.map((row) => [row.id, row]));
          for (const row of upserts) byId.set(row.id, row);
          rows = [...byId.values()];
        },
        news,
        publishState: () => {},
      },
      OLD,
      ROOT,
    );
    expect(done).toEqual({ kind: "moved", to: NEW });

    // What a reader holds once every publication has landed.
    const live = new Map<WorkId, Work>();
    for (const { id, work } of r.publishedWorks)
      if (work === null) live.delete(id);
      else live.set(id, work);
    await news.flush();
    const everything = JSON.stringify({
      works: r.works.persisted(),
      members: [...r.works.members.all()],
      views: r.views.read(),
      rows,
      published: [...live],
      news: said,
    });
    expect(said.join("")).toContain(NEW);
    expect(everything.split(`given:${OLD}`).join("")).not.toContain(OLD);
    expect(live.has(NEW)).toBe(true);

    // ... and the question asked under the old id is answered under the new.
    const answered = asks.answer({
      id: NEW,
      work: workOf(r, NEW),
      ask: asked.ask,
      from: "card",
      reply: { kind: "answered", values: new Map([["q-mode", ["full"]]]) },
    });
    expect(answered).toEqual({ kind: "answered" });
    expect(r.files.ops).toEqual([
      { kind: "move", from: workDirOf(OLD), to: workDirOf(NEW) },
    ]);
  });

  it("brings a finished work kept under a worktree path back under the root's id (T16)", async () => {
    const r = rigWith(finished(OLD_KEY, "csv export"));
    expect(await r.works.rekey(OLD, ROOT)).toEqual({ kind: "moved", to: NEW });
    const again = r.works.openFor({
      key: GIT_KEY,
      title: "csv export",
      request: { kind: "none" },
    });
    expect(again).toMatchObject({ id: NEW, created: false, reopened: true });
    expect(r.works.all().map(([id]) => id)).toEqual([NEW]);
    expect(r.files.ops).toEqual([
      { kind: "move", from: workDirOf(OLD), to: workDirOf(NEW) },
    ]);
  });

  it("leaves the work under its old key when its kept files cannot move", async () => {
    const r = rigWith(
      finished(OLD_KEY, "csv export"),
      opened(keyAt(ROOT, { kind: "git" }, "never-started"), "never started"),
    );
    r.files.failMoves = true;
    expect(await r.works.rekey(OLD, ROOT)).toEqual({
      kind: "deferred",
      why: "files-not-moved",
    });
    expect(r.works.get(NEW)).toEqual(Option.none());
    expect(workOf(r, OLD).key).toEqual(OLD_KEY);
    expect(r.errors).toHaveLength(1);
    // A later sweep — a card declined — keeps the old folder: its work is
    // still the work that names it.
    r.works.declined(workIdOf(keyAt(ROOT, { kind: "git" }, "never-started")));
    await drain();
    const sweeps = r.files.ops.flatMap((op) =>
      op.kind === "sweep" ? [op.keep] : [],
    );
    expect(sweeps.length).toBeGreaterThan(0);
    for (const keep of sweeps) expect(keep).toContain(workDirOf(OLD));
    expect(r.files.ops.some((op) => op.kind === "move")).toBe(false);
  });

  it("writes the record in the rename's own turn, so nothing takes the id between (N2)", async () => {
    // Another caller's turn, queued while the folder is renamed: a work
    // opened at the root's key. It must find the moved work there — not a
    // free id to open a second work at, which would send the folder back.
    const r = rigWith(finished(OLD_KEY, "csv export"));
    let during: unknown;
    r.files.during = () =>
      queueMicrotask(() => {
        during = r.works.openFor({
          key: GIT_KEY,
          title: "csv, again",
          request: { kind: "none" },
        });
      });
    expect(await r.works.rekey(OLD, ROOT)).toEqual({ kind: "moved", to: NEW });
    expect(during).toMatchObject({ id: NEW, created: false });
    expect(r.works.all().map(([id]) => id)).toEqual([NEW]);
    expect(r.files.ops).toEqual([
      { kind: "move", from: workDirOf(OLD), to: workDirOf(NEW) },
    ]);
    expect(r.errors).toEqual([]);
  });
});

describe("a re-key whose root another work holds", () => {
  it("keeps the old-key work where it was, held, and removes nothing (T27)", async () => {
    const holder = finished(GIT_KEY, "csv, the first time");
    const r = rigWith(holder, opened(OLD_KEY, "csv export"));
    expect(await r.works.rekey(OLD, ROOT)).toEqual({
      kind: "held",
      by: NEW,
      ended: false,
    });
    expect(r.works.all().map(([id]) => id)).toEqual([NEW, OLD]);
    expect(workOf(r, NEW)).toBe(holder);
    expect(workOf(r, OLD)).toMatchObject({
      key: HELD_KEY,
      state: { kind: "open" },
    });
    // Its branch is asked about in the root git said, not its old folder.
    expect(r.works.branchWatches()).toEqual([
      { work: OLD, host: "local", repo: ROOT, branch: expect.any(String) },
    ]);
    await drain();
    expect(r.files.ops).toEqual([]);
    expect(r.publishedWorks.filter((one) => one.work === null)).toEqual([]);
  });

  it("ends the old-key work and keeps it, with no finished cap, when both are open", async () => {
    // A FULL FINISHED LIST, and a collision: the ending a re-key causes is
    // the ordinary ending without the cap, so the list holds one more.
    const done = Array.from({ length: FINISHED_KEPT }, (_, i) =>
      finished(keyAt(ROOT, { kind: "git" }, `done-${i}`), `done ${i}`),
    );
    const r = rigWith(
      ...done,
      opened(GIT_KEY, "csv, the first time"),
      opened(OLD_KEY, "csv export"),
    );
    r.works.join(OLD, "local/t1", "planner", "asked");
    expect(await r.works.rekey(OLD, ROOT)).toMatchObject({
      kind: "held",
      ended: true,
    });
    await drain();
    expect(workOf(r, OLD)).toMatchObject({
      key: HELD_KEY,
      state: { kind: "ended", outcome: { kind: "stopped", by: "kolu" } },
    });
    expect(r.works.members.all().size).toBe(0);
    const ended = r.works
      .all()
      .filter(([, work]) => work.state.kind === "ended");
    expect(ended).toHaveLength(FINISHED_KEPT + 1);
    expect(r.files.ops.filter((op) => op.kind === "sweep")).toEqual([]);
    expect(r.publishedWorks.filter((one) => one.work === null)).toEqual([]);
  });

  it("is the work `openFor` of the root's key answers, while open (T28)", () => {
    const holder = finished(GIT_KEY, "csv, the first time");
    const r = rigWith(holder, opened(HELD_KEY, "csv export"));
    expect(
      r.works.openFor({
        key: GIT_KEY,
        title: "csv export",
        request: { kind: "none" },
      }),
    ).toMatchObject({ id: OLD, created: false, reopened: false });
    expect(workOf(r, NEW)).toBe(holder);
    expect(r.works.all()).toHaveLength(2);
  });

  it("refuses Reopen while another work is open on the branch (T29)", () => {
    const r = rigWith(
      finished(GIT_KEY, "csv, the first time"),
      opened(HELD_KEY, "csv export"),
    );
    expect(() => r.works.reopen(NEW)).toThrow(WorkRefusal);
    try {
      r.works.reopen(NEW);
    } catch (err) {
      expect(err).toMatchObject({ kind: "branch-open" });
      expect((err as WorkRefusal).why).toContain("«csv export»");
    }
    const s = rigWith(
      opened(GIT_KEY, "csv, the second time"),
      finished(HELD_KEY, "csv export"),
    );
    expect(() => s.works.reopen(OLD)).toThrow(/«csv, the second time»/);
  });

  it("moves to the root's id once the holder has gone (T30)", async () => {
    const r = rigWith(
      opened(GIT_KEY, "never started"),
      finished(HELD_KEY, "csv export"),
    );
    // The holder leaves the list — a declined card here; the finished cap
    // drops one the same way.
    expect(r.works.declined(NEW)).toBe(true);
    // The held work is finished, so the checkout watch does not read it; the
    // next `work_open` re-key does, and so does an open held work's watch:
    const s = rigWith(opened(HELD_KEY, "csv export"));
    s.watch.observedCheckout(OLD, {
      kind: "repository",
      root: ROOT,
      checkout: { kind: "at", path: WORKTREE },
    });
    await drain();
    expect(s.works.get(OLD)).toEqual(Option.none());
    expect(workOf(s, NEW)).toMatchObject({
      key: GIT_KEY,
      worktree: { kind: "at", path: WORKTREE },
    });
    expect(await r.works.rekey(OLD, ROOT)).toEqual({ kind: "moved", to: NEW });
    expect(workOf(r, NEW).key).toEqual(GIT_KEY);
  });
});
