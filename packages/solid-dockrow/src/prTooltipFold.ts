/** THE PR TOOLTIP, FOLDED RUN BY RUN — {@link prTooltip}'s string for a PR
 *  that arrives as a STORE.
 *
 *  A `PrInfo` a mirror hands out is a store record, so naming every check in
 *  one scope subscribes that scope to four nodes per run (the list, the index,
 *  `outcome`, `name`): a PR of a couple of hundred lanes crosses the 200
 *  sources Solid's development build judges `WIDE_SCOPE_DEPS`. Here each run
 *  is read by a memo of its own, chunks of {@link CHUNK} rows are joined, and
 *  the join joins the chunks — so a lane going red re-runs its own row, its
 *  chunk and the join, and nothing else.
 *
 *  Its own module beside `./prTooltip.ts` because THAT one is folded by a
 *  consumer's server through `./rowValues.ts` and must reach no SolidJS edge
 *  (`rowValues.purity.test.ts`). The string itself is spelled once, there.
 *
 *  It is this package's fold rather than the app's shared one because the pip
 *  is handed the VALUE: the bound has to hold for every consumer of the row
 *  package, and the package cannot depend on an application module. */

import type { PrInfo } from "anyforge/schemas";
import { type Accessor, createMemo, mapArray } from "solid-js";
import { type CheckLine, compose, lineOf } from "./prTooltip.ts";

/** Runs per chunk memo. A chunk reads its rows and the row list, so it holds
 *  `CHUNK + 1` sources, and the join above it holds `1 + ⌈N / CHUNK⌉`. */
const CHUNK = 128;

const sameLines = (
  a: ReadonlyArray<CheckLine>,
  b: ReadonlyArray<CheckLine>,
): boolean => a.length === b.length && a.every((one, at) => one === b[at]);

const sameLine = (
  a: CheckLine | undefined,
  b: CheckLine | undefined,
): boolean => a?.line === b?.line && a?.outcome === b?.outcome;

const sameCount = (
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): boolean => a.length === b.length;

export function createPrTooltip(pr: Accessor<PrInfo>): Accessor<string> {
  const runs = createMemo(
    () => Array.from({ length: pr().checkRuns.length }, (_, at) => at),
    { name: "prTooltip.runs", equals: sameCount },
  );
  const rows = mapArray(
    runs,
    (at) =>
      createMemo(
        (): CheckLine | undefined => {
          const one = pr().checkRuns[at];
          return one === undefined ? undefined : lineOf(one);
        },
        { name: "prTooltip.run", equals: sameLine },
      ),
    { name: "prTooltip.byRun" },
  );
  const starts = createMemo(
    () =>
      Array.from(
        { length: Math.ceil(rows().length / CHUNK) },
        (_, at) => at * CHUNK,
      ),
    { name: "prTooltip.chunks", equals: sameCount },
  );
  const chunks = mapArray(
    starts,
    (start) =>
      createMemo(
        () => {
          const all = rows();
          const out: CheckLine[] = [];
          const end = Math.min(start + CHUNK, all.length);
          for (let at = start; at < end; at++) {
            const one = all[at]?.();
            if (one !== undefined) out.push(one);
          }
          return out;
        },
        { name: "prTooltip.chunk", equals: sameLines },
      ),
    { name: "prTooltip.byChunk" },
  );
  return createMemo(
    () => {
      const one = pr();
      // THE HEADLINE'S OWN LEAVES, and nothing of the list: the number, the
      // title and the rollup are three nodes however many lanes the PR has.
      const head = { number: one.number, title: one.title, checks: one.checks };
      if (head.checks === null) return compose(head, []);
      const lines: CheckLine[] = [];
      for (const chunk of chunks()) lines.push(...chunk());
      return compose(head, lines);
    },
    { name: "prTooltip" },
  );
}
