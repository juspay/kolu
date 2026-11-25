/**
 * T30, the card's half: a work kept under its old key says which work holds
 * its branch — by title while kolu still has it, "another work" once that
 * one dropped off the finished list — and once a re-key has moved it to the
 * root's key (stamped `git`), the line is gone.
 */

import { Option } from "effect";
import {
  type BranchKey,
  openWork,
  type Work,
  type WorkId,
  workIdOf,
} from "kolu-work";
import { describe, expect, it } from "vitest";
import { heldWords } from "./heldKey";

const AT = "2026-11-24T19:00:00.000Z";
const key = (repo: string, repoBy: BranchKey["repoBy"]): BranchKey => ({
  kind: "branch",
  host: "local",
  repo,
  branch: "csv",
  repoBy,
});
const work = (k: BranchKey, title: string): Work =>
  openWork({ key: k, title, at: AT, request: { kind: "none" } });
const mapOf = (...works: Work[]): ReadonlyMap<WorkId, Work> =>
  new Map(works.map((one) => [workIdOf(one.key), one]));

describe("the card's line for a work kept under its old key", () => {
  const held = work(
    key("/repo/.worktrees/csv", { kind: "held", root: "/repo" }),
    "old",
  );

  it("names the work holding the branch", () => {
    const holder = work(key("/repo", { kind: "git" }), "holder");
    expect(heldWords(held, mapOf(held, holder))).toEqual(
      Option.some("Kept under its old key: «holder» holds csv in repo"),
    );
  });

  it("says another work once the holder is gone", () => {
    expect(heldWords(held, mapOf(held))).toEqual(
      Option.some("Kept under its old key: another work holds csv in repo"),
    );
  });

  it("is absent for a key that is git's or not said", () => {
    const moved = work(key("/repo", { kind: "git" }), "old");
    expect(heldWords(moved, mapOf(moved))).toEqual(Option.none());
    const written = work(key("/repo/sub", { kind: "as-written" }), "old");
    expect(heldWords(written, mapOf(written))).toEqual(Option.none());
  });
});
