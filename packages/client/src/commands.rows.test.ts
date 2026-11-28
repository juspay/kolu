/** The palette's works section is built PER WORK, and a row is its own memo.
 *
 *  Built the other way — one computation mapping every work — a fleet of
 *  thirty works puts a couple of hundred store leaves (`title`, the key's
 *  repo/branch/host, `decisions`, `events`) on ONE scope, which Solid's
 *  development build raises as `WIDE_SCOPE_DEPS` and which this project's
 *  vitest setup fails the test for; and every row object is rebuilt whenever
 *  any one work moves, so a reader of the list cannot tell which row changed.
 *
 *  Both are asserted here: the diagnostic (through
 *  `@kolu/solid-test-setup`'s `afterEach`) and the consumer-visible one —
 *  retitling ONE work leaves the other twenty-nine row objects identical.
 *
 *  THE WORKS COME FROM THE REAL MIRROR (`./conductor/collectionMirror.testlib`
 *  into `useWorks()`), because the rows read the app's shared snapshot of
 *  each work (`useWorkRecords`) rather than minting one of their own: a
 *  hand-made list of records is not a thing those rows can read, and a fixture
 *  that pretended otherwise would be judging a graph the browser never
 *  builds. How WIDE the rows are at fleet scale, and that each work is
 *  snapshotted once, is `./palette/workActions.wideDeps.test.ts`. */

import { settle } from "@kolu/surface/solid/testlib";
import type { Work, WorkId } from "kolu-work";
import { workIdOf } from "kolu-work";
import { createEffect, createRoot, flush } from "solid-js";
import { describe, expect, test, vi } from "vitest";
import type { PaletteAction } from "./CommandPalette";

const held = vi.hoisted(() => ({
  works: undefined as unknown,
  empty: undefined as unknown,
}));

vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

vi.mock("./wire", () => ({
  app: {
    collections: {
      works: { use: () => held.works },
      workMembers: { use: () => held.empty },
      memberReadings: { use: () => held.empty },
      workPrs: { use: () => held.empty },
    },
  },
}));

import { collectionMirror } from "./conductor/collectionMirror.testlib";
import { useWorks } from "./conductor/useWorks";
import { workPaletteRows } from "./palette/workActions";

const WORK_COUNT = 30;

function aWork(n: number): Work {
  return {
    key: {
      kind: "branch",
      host: "local",
      repo: `/home/code/repo-${n}`,
      branch: `feature-${n}`,
      repoBy: { kind: "git" },
    },
    title: `Work ${n}`,
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
    decisions: [],
    events: [],
    state: { kind: "open" },
    worktree: { kind: "unread" },
  };
}

const mirror = collectionMirror<WorkId, Work>("works");
held.works = mirror.view;
held.empty = collectionMirror<string, never>("empty").view;

/** The fleet, served oldest first — which is the order the section draws. */
const ids: WorkId[] = [];
for (let n = 0; n < WORK_COUNT; n++) {
  const work = aWork(n);
  const id = workIdOf(work.key);
  ids.push(id);
  mirror.push(id, work);
}
mirror.pushKeys(ids);

/** Mount the rows under a root and keep the last list an effect saw — the
 *  reader's view of the section, which is what the assertions judge. */
async function mounted() {
  let seen: ReadonlyArray<PaletteAction> = [];
  const dispose = createRoot((disposeRoot) => {
    const palette = workPaletteRows(useWorks());
    createEffect(
      () => palette(),
      (items) => {
        seen = items;
      },
    );
    return disposeRoot;
  });
  await settle();
  flush();
  return { dispose, items: () => seen };
}

describe("workPaletteRows", () => {
  test("keeps every other row's object when one work's title changes", async () => {
    const { dispose, items } = await mounted();
    expect(items()).toHaveLength(WORK_COUNT);
    expect(items()[7]?.name).toBe("Work 7");
    const before = items();

    const renamed = ids[7] as WorkId;
    mirror.push(renamed, { ...aWork(7), title: "Work 7, renamed" });
    await settle();
    flush();

    expect(items()[7]?.name).toBe("Work 7, renamed");
    const rebuilt = items()
      .map((row, i) => (row === before[i] ? -1 : i))
      .filter((i) => i >= 0);
    expect(rebuilt).toEqual([7]);
    dispose();
  });

  test("a row says what its work is and where", async () => {
    const { dispose, items } = await mounted();
    expect(items()[3]?.name).toBe("Work 3");
    expect(items()[3]?.description).toBe("repo-3 · feature-3 · local");
    dispose();
  });
});
