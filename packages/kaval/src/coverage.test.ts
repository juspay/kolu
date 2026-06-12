/**
 * The coverage ledger — makes "full coverage" mechanical, not aspirational.
 *
 * It introspects the live `ptyHostSurface` for the exact set of streams and
 * procedures it declares, and asserts the contract corpus's `CONTRACT_COVERAGE`
 * manifest equals it. Adding a procedure or stream to the surface without
 * covering it in `contractCorpus.testlib.ts` fails here — the same philosophy as
 * the staleKey closure test and B3's schema-key round-trip.
 */

import { describe, expect, it } from "vitest";
import { CONTRACT_COVERAGE } from "./contractCorpus.testlib.ts";
import { ptyHostSurface } from "./ptyHostSurface.ts";

describe("contract coverage ledger", () => {
  it("the corpus exercises exactly the streams the surface declares", () => {
    const declared = Object.keys(ptyHostSurface.spec.streams ?? {}).sort();
    expect([...CONTRACT_COVERAGE.streams].sort()).toEqual(declared);
  });

  it("the corpus exercises exactly the procedures the surface declares", () => {
    const groups = ptyHostSurface.spec.procedures ?? {};
    const declared: string[] = [];
    for (const [group, entries] of Object.entries(groups)) {
      for (const name of Object.keys(entries))
        declared.push(`${group}.${name}`);
    }
    expect([...CONTRACT_COVERAGE.procedures].sort()).toEqual(declared.sort());
  });
});
