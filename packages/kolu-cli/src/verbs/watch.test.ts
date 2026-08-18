/**
 * Pins `kolu watch`'s supervision GRAMMAR — the argv half, which is all this
 * face owns. What a bucket is (`isWaitState`) and what a knob means are padi's;
 * how a duration is spelled, and what a bad one reads like, is argv, and it is
 * decided here BEFORE anything dials a daemon.
 */

import { describe, expect, it } from "vitest";
import { planSupervision, type WatchArgs } from "./watch.ts";

const args = (over: Partial<WatchArgs> = {}): WatchArgs =>
  ({ id: undefined, json: false, ...over }) as WatchArgs;

describe("planSupervision", () => {
  it("plans NOTHING when no knob was named — bare `kolu watch` is still the change tail", () => {
    const plan = planSupervision(args());
    expect(plan).toEqual({ kind: "ok", value: undefined });
  });

  it("sends only the knobs the user actually spelled — the defaults are padi's", () => {
    expect(planSupervision(args({ nag: "5m" }))).toEqual({
      kind: "ok",
      value: { nagMs: 300_000 },
    });
  });

  it("reads every duration unit", () => {
    const held = (raw: string) =>
      planSupervision(args({ heldFor: raw })) as {
        value: { heldForMs: number };
      };
    expect(held("500ms").value.heldForMs).toBe(500);
    expect(held("60s").value.heldForMs).toBe(60_000);
    expect(held("5m").value.heldForMs).toBe(300_000);
    expect(held("2h").value.heldForMs).toBe(7_200_000);
    // `d`, because the feed's own hold column is rendered with `relativeTime`,
    // which prints `2d`. A grammar you can read out of the output and not type
    // back in is half a grammar.
    expect(held("1d").value.heldForMs).toBe(86_400_000);
  });

  it("reads a bare number as MILLISECONDS — the spelling the rest of the binary uses", () => {
    // `--timeout 10000`, `--settled 15000` and `--until idle:2000` are all bare
    // millisecond integers. One binary must not hold two duration grammars that
    // refuse each other's spelling.
    expect(planSupervision(args({ heldFor: "60000" }))).toEqual({
      kind: "ok",
      value: { heldForMs: 60_000 },
    });
  });

  it("refuses something that is neither — a unit it does not know, or a word", () => {
    for (const raw of ["banana", "5min", "1.5m", "-3s"]) {
      const plan = planSupervision(args({ heldFor: raw }));
      expect(plan.kind, raw).toBe("error");
      expect(plan.kind === "error" && plan.message).toMatch(
        /is not a duration/,
      );
    }
  });

  it("refuses a duration past the timer ceiling instead of overflowing into an instant repeat", () => {
    const plan = planSupervision(args({ nag: "99999h" }));
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(/~24\.8 days/);
  });

  it("refuses `--nag 0` — an interval of zero is a spin, not a fast nag", () => {
    const plan = planSupervision(args({ nag: "0s" }));
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(/spin/);
  });

  it("accepts `--held-for 0s` — report it the instant it enters", () => {
    expect(planSupervision(args({ heldFor: "0s" }))).toEqual({
      kind: "ok",
      value: { heldForMs: 0 },
    });
  });

  it("parses a comma list of buckets, any-of", () => {
    expect(planSupervision(args({ states: "waiting,awaiting" }))).toEqual({
      kind: "ok",
      value: { states: ["waiting", "awaiting"] },
    });
    // Spacing and case are typing, not meaning.
    expect(planSupervision(args({ states: " Waiting , awaiting " }))).toEqual({
      kind: "ok",
      value: { states: ["waiting", "awaiting"] },
    });
  });

  it("refuses a token that is not a bucket, and says which ones are", () => {
    const plan = planSupervision(args({ states: "idle" }));
    expect(plan.kind).toBe("error");
    expect(plan.kind === "error" && plan.message).toMatch(
      /working, awaiting, waiting/,
    );
  });

  it("refuses an empty --states rather than silently watching everything", () => {
    expect(planSupervision(args({ states: " , " })).kind).toBe("error");
  });
});
