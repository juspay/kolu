/** THE PR TOOLTIP, FOLDED RUN BY RUN — {@link prTooltip}'s string for a PR
 *  that arrives as a STORE.
 *
 *  A `PrInfo` a mirror hands out is a store record, so naming every check in
 *  one scope subscribes that scope to four nodes per run (the list, the index,
 *  `outcome`, `name`): a PR of a couple of hundred lanes crosses the 200
 *  sources Solid's development build judges `WIDE_SCOPE_DEPS`. Here each run
 *  is read by a memo of its own through `@kolu/surface/solid`'s `foldEach`,
 *  which joins the rows a chunk at a time — so a lane going red re-runs its
 *  own row, its chunk and the join, and nothing else.
 *
 *  Its own module beside `./prTooltip.ts` because THAT one is folded by a
 *  consumer's server through `./rowValues.ts` and must reach no SolidJS edge
 *  (`rowValues.purity.test.ts`). The string itself is spelled once, there. */

import { foldEach } from "@kolu/surface/solid";
import type { PrInfo } from "anyforge/schemas";
import { type Accessor, createMemo } from "solid-js";
import { type CheckLine, compose, lineOf } from "./prTooltip.ts";

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
  const lines = foldEach(
    "prTooltip.lines",
    runs,
    (at): CheckLine | undefined => {
      const one = pr().checkRuns[at];
      return one === undefined ? undefined : lineOf(one);
    },
    sameLine,
  );
  return createMemo(
    () => {
      const one = pr();
      // THE HEADLINE'S OWN LEAVES, and nothing of the list: the number, the
      // title and the rollup are three nodes however many lanes the PR has.
      const head = { number: one.number, title: one.title, checks: one.checks };
      if (head.checks === null) return compose(head, []);
      return compose(head, lines());
    },
    { name: "prTooltip" },
  );
}
