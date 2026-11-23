import { Option } from "effect";
import type { Filed, Visit } from "kolu-work";
import { describe, expect, it } from "vitest";
import { trailLabels } from "./trailView";

const MIN = 60_000;

/** A trail of visits, each `[stage, minutes]`; the last is the one the work
 *  is in when `open`. */
const trailOf = (
  visits: ReadonlyArray<readonly [Filed, number]>,
  open = false,
): ReadonlyArray<Visit> =>
  visits.map(([stage, minutes], index) => ({
    stage,
    from: new Date(index * MIN).toISOString(),
    until:
      open && index === visits.length - 1
        ? Option.none()
        : Option.some(new Date((index + 1) * MIN).toISOString()),
    time: { agent: minutes * MIN, you: 0, ci: 0 },
    events: { from: index, until: index + 1 },
  }));

/** The labels as a person reads them. */
const read = (trail: ReadonlyArray<Visit>) =>
  trailLabels(trail).map((label) =>
    label.kind === "rounds"
      ? `${label.rounds} rounds ${label.ms / MIN}m${label.now ? " now" : ""}`
      : `${label.stage} ${label.ms / MIN}m${label.now ? " now" : ""}`,
  );

describe("the trail's labels", () => {
  it("label six review rounds once, and every other visit by itself", () => {
    const rounds = Array.from({ length: 6 }, () => [
      ["review", 8] as const,
      ["build", 4] as const,
    ]).flat();
    const trail = trailOf(
      [
        ["plan", 60],
        ["approve", 2],
        ["build", 60],
        ...rounds,
        ["checks", 12],
        ["build", 15],
        ["checks", 8],
      ],
      true,
    );
    expect(read(trail)).toEqual([
      "plan 60m",
      "approve 2m",
      "build 60m",
      "6 rounds 72m",
      "checks 12m",
      "build 15m",
      "checks 8m now",
    ]);
    // Every visit is in exactly one label.
    const labels = trailLabels(trail);
    const covered = labels.flatMap((label) =>
      label.kind === "rounds"
        ? Array.from(
            { length: label.until - label.from },
            (_, one) => label.from + one,
          )
        : [label.visit],
    );
    expect(covered).toEqual(trail.map((_, index) => index));
  });

  it("count a review in progress as a round of the run it ends", () => {
    const trail = trailOf(
      [
        ["build", 30],
        ["review", 5],
        ["build", 5],
        ["review", 3],
      ],
      true,
    );
    expect(read(trail)).toEqual(["build 30m", "2 rounds 13m now"]);
  });

  it("leave one round as its own two labels", () => {
    const trail = trailOf([
      ["build", 30],
      ["review", 5],
      ["build", 5],
      ["checks", 10],
    ]);
    expect(read(trail)).toEqual([
      "build 30m",
      "review 5m",
      "build 5m",
      "checks 10m",
    ]);
  });

  it("keep a stretch nobody recorded as a label of its own", () => {
    const trail = trailOf([
      ["plan", 20],
      ["unrecorded", 90],
      ["checks", 10],
      ["unrecorded", 5],
      ["review", 15],
    ]);
    expect(read(trail)).toEqual([
      "plan 20m",
      "unrecorded 90m",
      "checks 10m",
      "unrecorded 5m",
      "review 15m",
    ]);
  });
});
