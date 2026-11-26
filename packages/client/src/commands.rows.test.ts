/** The palette's works section is built PER WORK.
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
 *  bumping ONE work's title leaves the other twenty-nine row objects
 *  identical. */

import type { Work, WorkId, WorkRow } from "kolu-work";
import { workIdOf } from "kolu-work";
import { createEffect, createRoot, createStore, flush } from "solid-js";
import { describe, expect, test } from "vitest";
import type { PaletteAction } from "./CommandPalette";
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

/** The work as the mirror would hand it out, with the one field this file
 *  moves left writable — a store a test can retitle. */
type RetitleableWork = Omit<Work, "title"> & { title: string };

/** The works as the palette reads them: a mirrored store, and an accessor
 *  that mints a FRESH `[id, work]` tuple per run — exactly what `useWorks`
 *  hands out, and what makes keying the row list necessary. */
function worksFixture() {
  const [works, setWorks] = createStore<RetitleableWork[]>(
    Array.from({ length: WORK_COUNT }, (_, n) => aWork(n)),
  );
  const ids: WorkId[] = works.map((work) => workIdOf(work.key));
  const rows = (): ReadonlyArray<WorkRow> =>
    works.map((work, i): WorkRow => [ids[i] as WorkId, work]);
  return { rows, setWorks };
}

/** Mount the rows under a root and keep the last list an effect saw — the
 *  reader's view of the section, which is what the assertions judge. */
function mounted() {
  const { rows, setWorks } = worksFixture();
  let seen: PaletteAction[] = [];
  const dispose = createRoot((disposeRoot) => {
    const palette = workPaletteRows(rows);
    createEffect(
      () => palette(),
      (items) => {
        seen = items;
      },
    );
    return disposeRoot;
  });
  flush();
  return { setWorks, dispose, items: () => seen };
}

describe("workPaletteRows", () => {
  test("keeps every other row's object when one work's title changes", () => {
    const { setWorks, dispose, items } = mounted();
    expect(items()).toHaveLength(WORK_COUNT);
    expect(items()[7]?.name).toBe("Work 7");
    const before = items();

    setWorks((draft) => {
      const one = draft[7];
      if (one === undefined) throw new Error("fixture: work 7 is absent");
      one.title = "Work 7, renamed";
    });
    flush();

    expect(items()[7]?.name).toBe("Work 7, renamed");
    const rebuilt = items()
      .map((row, i) => (row === before[i] ? -1 : i))
      .filter((i) => i >= 0);
    expect(rebuilt).toEqual([7]);
    dispose();
  });

  test("a row says what its work is and where", () => {
    const { dispose, items } = mounted();
    expect(items()[3]?.name).toBe("Work 3");
    expect(items()[3]?.description).toBe("repo-3 · feature-3 · local");
    dispose();
  });
});
