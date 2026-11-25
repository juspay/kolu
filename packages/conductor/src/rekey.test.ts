/**
 * A WORK RE-KEYED TO GIT'S ROOT, as the host writes it — and NOTHING REMOVED.
 *
 * - T15: a move carries everything that names the work — its record, its
 *   members, its Code view, the conversation's rows — so the old id is left
 *   only inside a `given:` ask id (a name minted once), and a question still
 *   open on it can be answered.
 * - T16: a finished work kept under a worktree path, re-keyed, is the work
 *   `openFor` of the root's key brings back — reopened, under the root's id.
 * - T27: another work holds the root's id: the old-key work stays where it
 *   was, `held`, the holder untouched — no kept-files move or sweep, and
 *   nothing published gone.
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
import { describe, expect, it } from "vitest";
import { asking } from "./asking.ts";
import { rowsMovedTo } from "./rekeyRows.ts";
import { workDirOf } from "./workFiles.ts";
import { type WorkRig, workRig } from "./workRig.testlib.ts";

const AT = "2026-11-24T19:00:00.000Z";
const ROOT = "/repo";
const WORKTREE = "/repo/.worktrees/csv";

const keyAt = (repo: string, repoBy: BranchKey["repoBy"]): BranchKey => ({
  kind: "branch",
  host: "local",
  repo,
  branch: "csv",
  repoBy,
});
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
  endWork(opened(key, title), { outcome: { kind: "merged", pr: 7 }, at: AT });

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
    const rows: ReadonlyArray<ConductorRow> = [
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

    expect(r.works.rekey(OLD, ROOT)).toEqual({ kind: "moved", to: NEW });
    const moved = rowsMovedTo(rows, OLD, NEW);
    const after = new Map(rows.map((row) => [row.id, row]));
    for (const row of moved) after.set(row.id, row);

    // What a reader holds once every publication has landed.
    const live = new Map<WorkId, Work>();
    for (const { id, work } of r.publishedWorks)
      if (work === null) live.delete(id);
      else live.set(id, work);
    const everything = JSON.stringify({
      works: r.works.persisted(),
      members: [...r.works.members.all()],
      views: r.views.read(),
      rows: [...after.values()],
      published: [...live],
    });
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
    await settle();
    expect(r.files.ops).toEqual([
      { kind: "move", from: workDirOf(OLD), to: workDirOf(NEW) },
    ]);
  });

  it("brings a finished work kept under a worktree path back under the root's id (T16)", async () => {
    const r = rigWith(finished(OLD_KEY, "csv export"));
    expect(r.works.rekey(OLD, ROOT)).toEqual({ kind: "moved", to: NEW });
    const again = r.works.openFor({
      key: GIT_KEY,
      title: "csv export",
      request: { kind: "none" },
    });
    expect(again).toMatchObject({ id: NEW, created: false, reopened: true });
    expect(r.works.all().map(([id]) => id)).toEqual([NEW]);
    await settle();
    expect(r.files.ops).toEqual([
      { kind: "move", from: workDirOf(OLD), to: workDirOf(NEW) },
    ]);
  });
});

describe("a re-key whose root another work holds", () => {
  it("keeps the old-key work where it was, held, and removes nothing (T27)", async () => {
    const holder = finished(GIT_KEY, "csv, the first time");
    const r = rigWith(holder, opened(OLD_KEY, "csv export"));
    expect(r.works.rekey(OLD, ROOT)).toEqual({
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
    await settle();
    expect(r.files.ops).toEqual([]);
    expect(r.publishedWorks.filter((one) => one.work === null)).toEqual([]);
  });

  it("ends the old-key work, and keeps it, when both are open", async () => {
    const r = rigWith(
      opened(GIT_KEY, "csv, the first time"),
      opened(OLD_KEY, "csv export"),
    );
    r.works.join(OLD, "local/t1", "planner", "asked");
    expect(r.works.rekey(OLD, ROOT)).toMatchObject({
      kind: "held",
      ended: true,
    });
    expect(workOf(r, OLD)).toMatchObject({
      key: HELD_KEY,
      state: { kind: "ended", outcome: { kind: "stopped", by: "kolu" } },
    });
    expect(r.works.members.all().size).toBe(0);
    await settle();
    for (const op of r.files.ops) {
      expect(op.kind).toBe("sweep");
      if (op.kind === "sweep")
        expect(op.keep).toEqual(
          expect.arrayContaining([workDirOf(NEW), workDirOf(OLD)]),
        );
    }
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

  it("moves to the root's id once the holder has gone (T30)", () => {
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
    expect(s.works.get(OLD)).toEqual(Option.none());
    expect(workOf(s, NEW)).toMatchObject({
      key: GIT_KEY,
      worktree: { kind: "at", path: WORKTREE },
    });
    expect(r.works.rekey(OLD, ROOT)).toEqual({ kind: "moved", to: NEW });
    expect(workOf(r, NEW).key).toEqual(GIT_KEY);
  });
});
