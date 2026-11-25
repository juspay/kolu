/**
 * EACH WORK'S LIVE PULL REQUEST — published from the work's own PR watch, on
 * every reading, and gone with the work.
 *
 * The card's mark and its check count are drawn from this collection. A
 * reading that records nothing on the timeline (the same word, more checks
 * landed) must still move it, and a work that ended must take it away.
 */

import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Option } from "effect";
import { describe, expect, it } from "vitest";
import { workRig } from "./workRig.testlib.ts";

/** The rig, with one branch work open. */
function rig() {
  const r = workRig();
  const id = r.works.openFor({
    key: {
      kind: "branch",
      host: "local",
      repo: "/repo",
      branch: "csv",
      repoBy: { kind: "git" },
    },
    title: "csv",
    request: { kind: "none" },
  }).id;
  return { ...r, id };
}

/** The forge's answer for the branch: PR #7, open, with `landed` of three
 *  checks passed and the rest still running. */
const reading = (
  landed: number,
  state: "open" | "merged" = "open",
): PrResult => ({
  kind: "ok",
  value: {
    number: 7,
    title: "Add CSV export",
    url: "https://example.invalid/pull/7",
    state,
    checks: landed === 3 ? "pass" : "pending",
    checkRuns: [0, 1, 2].map((i) => ({
      name: `c${i}`,
      outcome: i < landed ? ("pass" as const) : ("pending" as const),
    })) as never,
    reviewDecision: null,
    mergeStateStatus: "UNKNOWN",
    headSha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
    isDraft: false,
  },
});

describe("a work's live pull request", () => {
  it("is published on a reading that records nothing on the timeline", () => {
    const r = rig();
    r.watch.observedPr(r.id, reading(1));
    const work = r.works.get(r.id);
    expect(r.published.at(-1)).toEqual({ id: r.id, pr: reading(1) });

    // One more check landed: the rollup still says pending, so the timeline
    // learns nothing, and the live count moves all the same.
    r.watch.observedPr(r.id, reading(2));
    expect(r.works.get(r.id)).toEqual(work);
    expect(r.published.at(-1)).toEqual({ id: r.id, pr: reading(2) });
  });

  it("is published once for the same reading twice", () => {
    const r = rig();
    r.watch.observedPr(r.id, reading(1));
    r.watch.observedPr(r.id, reading(1));
    expect(r.published).toHaveLength(1);
  });

  it("is published for a reading kolu concludes nothing from", () => {
    const r = rig();
    r.watch.observedPr(r.id, { kind: "pending" });
    expect(r.published).toEqual([{ id: r.id, pr: { kind: "pending" } }]);
  });

  it("goes when the work ends", () => {
    const r = rig();
    r.watch.observedPr(r.id, reading(1));
    r.works.stop(r.id, "you");
    expect(r.published.at(-1)).toEqual({ id: r.id, pr: null });
  });

  it("goes when the reading itself ends the work", () => {
    const r = rig();
    r.watch.observedPr(r.id, reading(3));
    r.watch.observedPr(r.id, reading(3, "merged"));
    expect(Option.getOrThrow(r.works.get(r.id)).state.kind).toBe("ended");
    expect(r.published.at(-1)).toEqual({ id: r.id, pr: null });
  });

  it("is never kept for a work that is not open", () => {
    const r = rig();
    r.works.stop(r.id, "you");
    r.watch.observedPr(r.id, reading(1));
    expect(r.published).toEqual([]);
  });
});
